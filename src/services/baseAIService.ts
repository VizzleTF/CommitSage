import { ApiErrorResult, CommitMessage, GenerateOptions, ProgressReporter } from '../models/types';
import { errorMessages } from '../utils/constants';
import { ApiKeyInvalidError, TruncatedResponseError } from '../models/errors';
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

/** Absolute cap on the output budget, so a hand-edited config can't ask a provider for millions of tokens. */
export const MAX_OUTPUT_TOKENS_CEILING = 32768;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
/** Doubling past this many retries would only burn quota — the budget is not the problem by then. */
const MAX_BUDGET_DOUBLINGS = 3;

/**
 * Shared output-token budget (`general.maxOutputTokens`, default 4096).
 *
 * A commit message is ~40-60 tokens, so this is a runaway guard, not a length
 * limit. It has to be generous because reasoning models bill their thinking
 * against the same budget: Gemini 2.5 Pro cannot disable thinking at all, and
 * the old hardcoded 1024 left ~40 tokens for the answer, truncating it (#447).
 */
export function getConfiguredMaxOutputTokens(): number {
    const raw = ConfigService.get('general.maxOutputTokens');
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        return DEFAULT_MAX_OUTPUT_TOKENS;
    }
    return Math.min(Math.floor(raw), MAX_OUTPUT_TOKENS_CEILING);
}

/**
 * Output budget for a single attempt, doubled on each retry. Truncation is the
 * one failure a retry can fix only by asking for more room — replaying the same
 * budget would truncate at exactly the same place.
 */
export function resolveMaxOutputTokens(options?: GenerateOptions, attempt: number = 1): number {
    const base = options?.maxTokens ?? getConfiguredMaxOutputTokens();
    const doublings = Math.min(Math.max(attempt - 1, 0), MAX_BUDGET_DOUBLINGS);
    return Math.min(base * 2 ** doublings, MAX_OUTPUT_TOKENS_CEILING);
}

/**
 * Wraps the per-attempt body of an HTTP-LLM provider with the shared
 * error-handling envelope: throw `ApiKeyInvalidError` on HTTP 401 (so
 * `commitWorkflow.handleInvalidApiKey` reprompts the user), otherwise
 * delegate to `RetryUtils.handleGenerationError` for retry/backoff
 * with `handleHttpError` as the mapper.
 *
 * Used by OpenAI, Codestral, Gemini's single-model branch, and Ollama. Ollama
 * passes a custom `errorMapper` for its self-hosted 404/500/network wording;
 * everyone else gets the default `handleHttpError` mapping.
 */
export async function withRetryAndApiKeyGuard(
    name: string,
    prompt: string,
    progress: ProgressReporter,
    attempt: number,
    retryFn: (prompt: string, progress: ProgressReporter, attempt: number) => Promise<CommitMessage>,
    fn: () => Promise<CommitMessage>,
    errorMapper?: (err: Error) => ApiErrorResult,
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
            errorMapper ?? ((err: Error) => handleHttpError(err, `${name} API`))
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
    // Retryable, and worth retrying: the next attempt gets double the budget.
    if (error instanceof TruncatedResponseError) {
        return { errorMessage: error.message, shouldRetry: true };
    }

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
