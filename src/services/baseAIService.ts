import { ApiErrorResult, CommitMessage, ProgressReporter } from '../models/types';
import { errorMessages } from '../utils/constants';
import { ApiKeyInvalidError } from '../models/errors';
import { RetryUtils } from '../utils/retryUtils';
import { toError } from '../utils/errorUtils';
import { HttpError, NetworkError } from '../utils/httpUtils';
import { ConfigService } from '../utils/configService';

/**
 * Shared LLM sampling temperature (`general.temperature`, default 0.7).
 * Clamped to [0, 2] — most providers reject values outside this range,
 * and a project config can't legitimately need otherwise. Defaults to
 * 0.7 if the setting is unreadable or out of type.
 */
export function getConfiguredTemperature(): number {
    const raw = ConfigService.get('general.temperature');
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return 0.7;
    }
    return Math.max(0, Math.min(2, raw));
}

/**
 * Wraps the per-attempt body of an HTTP-LLM provider with the shared
 * error-handling envelope: throw `ApiKeyInvalidError` on HTTP 401 (so
 * `commitWorkflow.handleInvalidApiKey` reprompts the user), otherwise
 * delegate to `RetryUtils.handleGenerationError` for retry/backoff
 * with `handleHttpError` as the mapper.
 *
 * Used by OpenAI, Codestral, and Gemini's single-model branch. Ollama
 * duplicates the 401 throw outside this helper because its 404/500
 * mapping is structurally different (no `WWW-Authenticate` semantics on
 * a self-hosted server).
 */
export async function withRetryAndApiKeyGuard(
    name: string,
    prompt: string,
    progress: ProgressReporter,
    attempt: number,
    retryFn: (prompt: string, progress: ProgressReporter, attempt: number) => Promise<CommitMessage>,
    fn: () => Promise<CommitMessage>
): Promise<CommitMessage> {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof HttpError && isInvalidApiKeyError(error)) {
            throw new ApiKeyInvalidError(name);
        }
        return RetryUtils.handleGenerationError(
            toError(error),
            prompt,
            progress,
            attempt,
            retryFn,
            (err: Error) => handleHttpError(err, `${name} API`)
        );
    }
}

/**
 * Detect "invalid API key" across providers that don't all use HTTP 401.
 * - OpenAI/Anthropic/Groq/Codestral/OpenRouter/DeepSeek/Ollama → 401
 * - **xAI** → **400** with body `{"code":"Client specified an invalid argument",
 *   "error":"Incorrect API key provided: ..."}` — non-standard, but observed in
 *   production. Match on the message string rather than only the status.
 */
export function isInvalidApiKeyError(error: HttpError): boolean {
    if (error.status === 401) {
        return true;
    }
    if (error.status === 400) {
        const data = error.data;
        const message =
            typeof data === 'string'
                ? data
                : (data as { error?: string | { message?: string } } | undefined)?.error;
        const messageText =
            typeof message === 'string'
                ? message
                : message?.message ?? JSON.stringify(data);
        return /incorrect api key|invalid api key|api key.*(?:invalid|expired|revoked)/i.test(messageText ?? '');
    }
    return false;
}

export function validateCommitMessage(message: string): string {
    const cleanMessage = message.trim();
    if (!cleanMessage) {
        throw new Error('Generated commit message is empty.');
    }
    return cleanMessage;
}

export function extractAndValidateMessage(
    content: string | undefined | null,
    serviceName: string,
): string {
    if (!content) {
        throw new Error(`Invalid response format from ${serviceName} API`);
    }
    return validateCommitMessage(content);
}

type HttpErrorData =
    | { error?: string | { message?: string }; code?: string }
    | string
    | undefined;

function extractErrorMessage(data: HttpErrorData): string | undefined {
    const rawError = typeof data === 'object' ? data?.error : undefined;
    return typeof rawError === 'string' ? rawError : rawError?.message;
}

function handle403(
    status: number,
    errorMessage: string | undefined,
    data: HttpErrorData,
): ApiErrorResult {
    // xAI returns 403 when a team has no credits/licenses yet,
    // with `error: "Your newly created team doesn't have any
    // credits or licenses yet. ..."`. Surface that text directly
    // so users see the purchase URL instead of a generic 403.
    const text = errorMessage ?? (typeof data === 'string' ? data : '');
    if (/credits or licenses/i.test(text)) {
        return { errorMessage: text, shouldRetry: false, statusCode: status };
    }
    return {
        errorMessage: text || errorMessages.authenticationError,
        shouldRetry: false,
        statusCode: status,
    };
}

function handleHttpStatus(
    status: number,
    errorMessage: string | undefined,
    data: HttpErrorData,
): ApiErrorResult {
    switch (status) {
        case 401:
            return { errorMessage: errorMessages.authenticationError, shouldRetry: false, statusCode: status };
        case 402:
            return { errorMessage: errorMessages.paymentRequired, shouldRetry: false, statusCode: status };
        case 403:
            return handle403(status, errorMessage, data);
        case 429:
            return { errorMessage: errorMessages.rateLimitExceeded, shouldRetry: true, statusCode: status };
        case 422:
            return { errorMessage: errorMessage || errorMessages.invalidRequest, shouldRetry: false, statusCode: status };
        case 500:
            return { errorMessage: errorMessages.serverError, shouldRetry: true, statusCode: status };
        default: {
            const responseData = typeof data === 'string' ? data : JSON.stringify(data);
            return {
                errorMessage: `${errorMessages.apiError.replace('{0}', String(status))}: ${errorMessage || responseData}`,
                shouldRetry: status >= 500,
                statusCode: status,
            };
        }
    }
}

export function handleHttpError(error: Error, serviceName: string): ApiErrorResult {
    if (error instanceof HttpError) {
        // Provider error bodies are inconsistent: some use `{error: {message}}`,
        // some `{error: "..."}` (a string), some bare strings. Normalize.
        const data = error.data as HttpErrorData;
        const errorMessage = extractErrorMessage(data);
        return handleHttpStatus(error.status, errorMessage, data);
    }

    if (error instanceof NetworkError) {
        return {
            errorMessage: `Could not connect to ${serviceName}. Please check your internet connection.`,
            shouldRetry: true,
        };
    }

    return {
        errorMessage: error.message || 'Unknown error',
        shouldRetry: false,
    };
}
