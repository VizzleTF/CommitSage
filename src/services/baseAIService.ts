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
 * Request fragments that switch a provider's thinking off, strongest first.
 * Each API (and often each model behind it) accepts a different field or
 * value and answers the wrong one with HTTP 400, so the 400 picks the step:
 * see `nextThinkingStep`. Past the last step nothing is sent, which is the
 * behavior without `general.disableThinking`.
 */
export type ThinkingLadder = readonly Record<string, unknown>[];

/** Ladder step learned per `<provider>|<model>` from 400s, kept for the session. */
const learnedThinkingSteps = new Map<string, number>();

// The field itself is unknown to the API, so a weaker value of it fails too.
const UNKNOWN_FIELD = /unsupported parameter|unrecognized|unknown (?:parameter|field|name)|extra (?:inputs|fields)|not permitted/;

/**
 * Step to try after `error`, or `undefined` when the error is not about the
 * current fragment (it then stands). A 400 that names the fragment's field,
 * quotes one of its values (OpenAI: "Unsupported value: 'minimal' is not
 * supported with the 'gpt-5.6-sol' model."), or mentions thinking/reasoning at
 * all moves one step down; one that says the field is unknown skips every step
 * that sends the same field.
 */
export function nextThinkingStep(error: unknown, ladder: ThinkingLadder, step: number): number | undefined {
    const fragment = ladder[step];
    if (!fragment || !(error instanceof HttpError) || error.status !== 400) {
        return undefined;
    }
    const text = (typeof error.data === 'string' ? error.data : JSON.stringify(error.data ?? '')).toLowerCase();
    const keys = Object.keys(fragment);
    const quoted = stringValues(fragment).some(value => text.includes(`'${value}'`) || text.includes(`\\"${value}\\"`));
    if (!quoted && !keys.some(key => text.includes(key.toLowerCase())) && !/think|reason/.test(text)) {
        return undefined;
    }
    let next = step + 1;
    if (UNKNOWN_FIELD.test(text)) {
        while (next < ladder.length && Object.keys(ladder[next]).some(key => keys.includes(key))) {
            next++;
        }
    }
    return next;
}

function stringValues(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value.toLowerCase()];
    }
    return typeof value === 'object' && value !== null ? Object.values(value).flatMap(stringValues) : [];
}

/**
 * Sends one request through `send`, adding the thinking-off fragment when
 * `general.disableThinking` is on and walking `ladder` down on each 400 about
 * it. Without the setting `send` gets `{}` and runs once.
 */
export async function sendWithThinkingLadder<T>(
    key: string,
    ladder: ThinkingLadder,
    send: (fragment: Record<string, unknown>) => Promise<T>,
): Promise<T> {
    // `=== true`: `.commitsage/config.json` is parsed leniently and may hold a string.
    if (ConfigService.get('general.disableThinking') !== true || ladder.length === 0) {
        return send({});
    }
    let step = learnedThinkingSteps.get(key) ?? 0;
    for (;;) {
        try {
            return await send(ladder[step] ?? {});
        } catch (error) {
            const next = nextThinkingStep(error, ladder, step);
            if (next === undefined) {
                throw error;
            }
            Logger.log(`${key} rejected ${JSON.stringify(ladder[step])}, retrying with ${JSON.stringify(ladder[next] ?? {})}`);
            step = next;
            learnedThinkingSteps.set(key, step);
        }
    }
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
 * gets the default `handleHttpError` mapping. `signal` cuts the wait between
 * attempts short.
 */
export async function withRetryAndApiKeyGuard(
    name: string,
    progress: ProgressReporter,
    fn: (attempt: number) => Promise<CommitMessage>,
    {
        signal,
        errorMapper = err => handleHttpError(err, `${name} API`),
    }: { signal?: AbortSignal; errorMapper?: (err: Error) => ApiErrorResult } = {},
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
            await RetryUtils.handleGenerationError(toError(error), progress, attempt, errorMapper, signal);
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

/** Longest provider-requested wait worth keeping the progress open for. */
const MAX_RETRY_AFTER_MS = 10_000;

// 429s that a retry cannot fix until billing changes or the period resets.
const EXHAUSTED_QUOTA_CODES = new Set([
    // OpenAI: `error.type` (and legacy `error.code`) insufficient_quota, plus the billing `error.code`s.
    'insufficient_quota',
    'credit_balance_exhausted',
    'organization_spend_limit_exceeded',
    'project_spend_limit_exceeded',
    'organization_usage_limit_exceeded',
    // Anthropic tier spend cap: `error.details.error_code`, sent without retry-after.
    'enforced_spend_limit_reached',
]);

/**
 * Milliseconds from a `Retry-After` value: delta-seconds or an HTTP-date
 * (RFC 9110 §10.2.3). `undefined` when absent or unreadable.
 */
export function parseRetryAfter(value: string | undefined, now: number = Date.now()): number | undefined {
    if (!value?.trim()) {
        return undefined;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
        return seconds >= 0 ? seconds * 1000 : undefined;
    }
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

type RateLimitBody = { error?: { type?: unknown; code?: unknown; details?: unknown } };
// Gemini 429 `error.details` entries (google.rpc.QuotaFailure / RetryInfo).
type GoogleRpcDetail = { violations?: Array<{ quotaId?: unknown }>; retryDelay?: unknown };

function isQuotaExhausted(data: unknown): boolean {
    const error = typeof data === 'object' ? (data as RateLimitBody | null)?.error : undefined;
    if (typeof error !== 'object' || error === null) {
        return false;
    }
    const { type, code, details } = error;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const detailCode = (details as { error_code?: unknown } | undefined)?.error_code;
    if ([type, code, detailCode].some(value => typeof value === 'string' && EXHAUSTED_QUOTA_CODES.has(value))) {
        return true;
    }
    // Gemini per-day quotas reset at midnight Pacific; a short retryDelay does not refill them.
    return Array.isArray(details) && (details as GoogleRpcDetail[]).some(detail =>
        detail?.violations?.some(v => typeof v?.quotaId === 'string' && v.quotaId.includes('PerDay')));
}

/** Gemini's wait from google.rpc.RetryInfo, a duration such as "27s". */
function googleRetryDelayMs(data: unknown): number | undefined {
    const details = typeof data === 'object' ? (data as RateLimitBody | null)?.error?.details : undefined;
    const delay = Array.isArray(details)
        ? (details as GoogleRpcDetail[]).find(detail => typeof detail?.retryDelay === 'string')?.retryDelay as string | undefined
        : undefined;
    return delay?.endsWith('s') ? parseRetryAfter(delay.slice(0, -1)) : undefined;
}

function handleRateLimit(error: HttpError, providerMessage: string | undefined): ApiErrorResult {
    const statusCode = error.status;
    if (isQuotaExhausted(error.data)) {
        return {
            errorMessage: providerMessage ? `${errorMessages.quotaExhausted} (${providerMessage})` : errorMessages.quotaExhausted,
            shouldRetry: false,
            statusCode,
        };
    }
    const retryAfterMs = parseRetryAfter(error.retryAfter) ?? googleRetryDelayMs(error.data);
    if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) {
        return {
            errorMessage: errorMessages.rateLimitRetryAfter.replace('{0}', String(Math.ceil(retryAfterMs / 1000))),
            shouldRetry: false,
            statusCode,
        };
    }
    return { errorMessage: errorMessages.rateLimitExceeded, shouldRetry: true, statusCode, retryAfterMs };
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
        return error.status === 429
            ? handleRateLimit(error, errorMessage)
            : handleHttpStatus(error.status, errorMessage, data);
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
