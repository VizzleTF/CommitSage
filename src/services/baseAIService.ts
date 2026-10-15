import { ApiErrorResult, CommitMessage, GenerateOptions, ProgressReporter } from '../models/types';
import { errorMessages } from '../utils/constants';
import { ApiKeyInvalidError, TruncatedResponseError } from '../models/errors';
import { RetryUtils } from '../utils/retryUtils';
import { toError } from '../utils/errorUtils';
import { HttpError, NetworkError } from '../utils/httpUtils';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';

/**
 * Shared LLM sampling temperature (`general.temperature`), or `undefined` when
 * the request must not carry one. The default `-1` (any negative or unreadable
 * value) keeps each model on its provider default: Claude 4.7+ answers HTTP 400
 * to any other value, OpenAI reasoning models accept only 1, Gemini 3 is tuned
 * for 1.0. Capped at 2, which most providers enforce.
 */
export function getConfiguredTemperature(): number | undefined {
    const raw = ConfigService.get('general.temperature');
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        return undefined;
    }
    return Math.min(2, raw);
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
function getConfiguredMaxOutputTokens(): number {
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
 * Runs the per-attempt body of an HTTP-LLM provider inside the shared
 * error-handling envelope: an invalid key (see `isInvalidApiKeyError`) throws
 * `ApiKeyInvalidError` so `commitWorkflow.handleInvalidApiKey` reprompts the
 * user; any other error goes to `RetryUtils.handleGenerationError`, which waits
 * out the backoff or throws. `fn` gets the 1-based attempt so it can grow the
 * output budget (`resolveMaxOutputTokens`).
 *
 * Used by every provider except Gemini's auto mode. Ollama passes a custom
 * `errorMapper` for its self-hosted 404/500/network wording; everyone else
 * gets the default `handleHttpError` mapping.
 */
export async function withRetryAndApiKeyGuard(
    name: string,
    progress: ProgressReporter,
    fn: (attempt: number) => Promise<CommitMessage>,
    errorMapper: (err: Error) => ApiErrorResult = err => handleHttpError(err, `${name} API`),
): Promise<CommitMessage> {
    for (let attempt = 1; ; attempt++) {
        RetryUtils.updateProgressForAttempt(progress, attempt);
        try {
            const result = await fn(attempt);
            progress.report({ message: 'Processing generated message...', increment: 90 });
            Logger.log(`Commit message generated using ${result.model} model`);
            return result;
        } catch (error) {
            if (error instanceof HttpError && isInvalidApiKeyError(error)) {
                throw new ApiKeyInvalidError(name);
            }
            await RetryUtils.handleGenerationError(toError(error), progress, attempt, errorMapper);
        }
    }
}

/**
 * Detect "invalid API key" across providers that don't all use HTTP 401.
 * - OpenAI/Anthropic/Groq/Codestral/OpenRouter/DeepSeek/Ollama → 401
 * - **xAI** → **400** with body `{"code":"Client specified an invalid argument",
 *   "error":"Incorrect API key provided: ..."}`
 * - **Gemini** → **400** with `{"error":{"message":"API key not valid. Please
 *   pass a valid API key.","status":"INVALID_ARGUMENT"}}`
 * Both 400s are non-standard, so match on the message rather than the status.
 */
export function isInvalidApiKeyError(error: HttpError): boolean {
    if (error.status === 401) {
        return true;
    }
    if (error.status !== 400) {
        return false;
    }
    const data = error.data as HttpErrorData;
    const text = extractErrorMessage(data) ?? (typeof data === 'string' ? data : JSON.stringify(data));
    return /incorrect api key|invalid api key|api key not valid|api key.*(?:invalid|expired|revoked)/i.test(text ?? '');
}

// C0/C1 controls except \t and \n, bidi overrides and isolates, zero-width
// characters: invisible in the commit box, they can hide or reorder text.
// A ZWJ before a pictograph is kept: it joins emoji such as U+1F9D1 U+200D U+1F4BB.
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B\u200C\u2060\uFEFF\u202A-\u202E\u2066-\u2069]|\u200D(?!\p{Extended_Pictographic})/gu;
// Conservative, English only: "Here is the commit message:", "Commit message:".
const PREAMBLE = /^(?:here(?:'s| is)\b[^\n]*\bcommit message\b[^\n]*|(?:suggested |generated |proposed )?commit message)[ \t]*:[ \t]*\n+(?=\S)/i;
// One outer fence, optional language tag: ```text\n…\n``` or ```…```.
const OUTER_FENCE = /^```(?:[\w.+-]*\n)?([\s\S]*?)\n?```$/;
// A wrapping quote pair: the opening and closing characters share an index.
const OPEN_QUOTES = '"\'`\u201C';
const CLOSE_QUOTES = '"\'`\u201D';

/** `"feat: x"` → `feat: x`; kept when the quote is also inside: `a` and `b`. */
function stripWrappingQuotes(text: string): string {
    const close = CLOSE_QUOTES[OPEN_QUOTES.indexOf(text[0])];
    if (!close || text.length < 2 || !text.endsWith(close)) {
        return text;
    }
    const inner = text.slice(1, -1);
    return inner.includes(text[0]) || inner.includes(close) ? text : inner.trim();
}

/** Deterministic cleanup of the wrapping models put around a commit message. */
function cleanReply(content: string): string {
    const unwrapped = content
        // Reasoning models (Ollama deepseek-r1/qwen3, OpenAI-compatible endpoints)
        // may inline their <think> blocks; a reply that is only thinking is empty.
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(INVISIBLE_CHARS, '')
        .trim()
        .replace(PREAMBLE, '')
        .replace(OUTER_FENCE, '$1')
        .trim();
    return stripWrappingQuotes(unwrapped)
        // A sign-off certifies the human author; git adds it (--signoff), the model never does.
        .replace(/^[ \t]*signed-off-by:.*(?:\n|$)/gim, '')
        .trim();
}

export function extractAndValidateMessage(
    content: string | undefined | null,
    serviceName: string,
): string {
    if (!content) {
        throw new Error(`Invalid response format from ${serviceName} API`);
    }
    const cleanMessage = cleanReply(content);
    if (!cleanMessage) {
        throw new Error('Generated commit message is empty.');
    }
    return cleanMessage;
}

type HttpErrorData =
    | { error?: string | { message?: string }; code?: string }
    | string
    | undefined;

function extractErrorMessage(data: HttpErrorData): string | undefined {
    const rawError = typeof data === 'object' ? data?.error : undefined;
    return typeof rawError === 'string' ? rawError : rawError?.message;
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
        case 403: {
            // xAI answers 403 with "... no credits or licenses yet" and a
            // purchase link: the provider's own text beats a generic auth error.
            const text = errorMessage ?? (typeof data === 'string' ? data : '');
            return { errorMessage: text || errorMessages.authenticationError, shouldRetry: false, statusCode: status };
        }
        case 429:
            return { errorMessage: errorMessages.rateLimitExceeded, shouldRetry: true, statusCode: status };
        case 404: {
            // Mostly a retired or mistyped model id (OpenAI `model_not_found`,
            // Anthropic `not_found_error`); keep the provider's text, it names the model.
            const text = errorMessage ?? (typeof data === 'string' ? data : '');
            return {
                errorMessage: text ? `${errorMessages.notFound} (${text})` : errorMessages.notFound,
                shouldRetry: false,
                statusCode: status,
            };
        }
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
