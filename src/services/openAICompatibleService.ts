import { Logger } from '../utils/logger';
import type { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { extractAndValidateMessage, getConfiguredTemperature, resolveMaxOutputTokens, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpError, HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ConfigService } from '../utils/configService';
import { ApiKeyManager } from './apiKeyManager';
import { providerMeta } from './providerCatalog';
import { Provider } from '../views/webview/protocol';
import { TruncatedResponseError } from '../models/errors';

interface OpenAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
        // eslint-disable-next-line @typescript-eslint/naming-convention
        finish_reason?: string;
    }>;
}

/**
 * Single request to an OpenAI-compatible `chat/completions` endpoint.
 * Used by OpenAI, Groq, OpenRouter, DeepSeek, xAI, and the user-configurable
 * "Custom" provider — every vendor that mirrors OpenAI's wire format.
 *
 * Anthropic is NOT OpenAI-compatible (different request/response shape,
 * `x-api-key` header style) — see `anthropicService.ts`.
 */
export interface OpenAICompatibleRequest {
    providerLabel: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    chatCompletionsPath?: string;
    extraHeaders?: Record<string, string>;
    /** Initial output-budget field name; a 400 naming it flips it (see `fixPayloadFromError`). */
    maxTokensParam?: TokenParam;
}

type TokenParam = 'max_tokens' | 'max_completion_tokens';

interface PayloadShape {
    tokenParam: TokenParam;
    omitTemperature: boolean;
}

/**
 * Payload shape learned per `baseUrl|model` from 400s, kept for the session so
 * only the first request to e.g. gpt-5 pays the extra round-trips.
 */
const learnedShapes = new Map<string, PayloadShape>();

/**
 * Reasoning models (OpenAI gpt-5/o-series, also behind Azure, OpenRouter or a
 * custom proxy) reject `max_tokens` and any non-default `temperature` with a
 * 400 whose OpenAI-style body names the offending field:
 *   `{"error":{"param":"max_tokens","message":"Unsupported parameter: 'max_tokens' ..."}}`
 *   `{"error":{"param":"temperature","message":"Unsupported value: 'temperature' ..."}}`
 * Model names are unreliable (Azure deployments, proxies), so the error itself
 * decides. Returns the corrected shape, or undefined when the error is something else.
 */
function fixPayloadFromError(error: unknown, shape: PayloadShape): PayloadShape | undefined {
    if (!(error instanceof HttpError) || error.status !== 400) {
        return undefined;
    }
    const body = error.data as { error?: { param?: unknown; message?: unknown } } | string | undefined;
    const err = typeof body === 'object' ? body?.error : undefined;
    const message = typeof body === 'string' ? body : String(err?.message ?? '');
    const param = typeof err?.param === 'string' ? err.param : /'(\w+)'/.exec(message)?.[1];

    if (param === shape.tokenParam) {
        const other = shape.tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
        return { ...shape, tokenParam: other };
    }
    if (param === 'temperature' && !shape.omitTemperature) {
        return { ...shape, omitTemperature: true };
    }
    return undefined;
}

export async function generateViaOpenAICompatible(
    request: OpenAICompatibleRequest,
    prompt: string,
    progress: ProgressReporter,
    attempt: number,
    retryFn: (
        prompt: string,
        progress: ProgressReporter,
        attempt: number,
    ) => Promise<CommitMessage>,
    options?: GenerateOptions,
): Promise<CommitMessage> {
    return withRetryAndApiKeyGuard(
        request.providerLabel,
        prompt,
        progress,
        attempt,
        retryFn,
        async () => {
            const path = request.chatCompletionsPath ?? '/chat/completions';
            const baseUrl = HttpUtils.stripTrailingSlashes(request.baseUrl);

            const shapeKey = `${baseUrl}|${request.model}`;
            let shape: PayloadShape = learnedShapes.get(shapeKey) ?? {
                tokenParam: request.maxTokensParam ?? 'max_tokens',
                omitTemperature: false,
            };

            await RetryUtils.updateProgressForAttempt(progress, attempt);

            let data: OpenAIResponse;
            // At most two corrections (token field + temperature), then the error stands.
            for (let fixes = 0; ; fixes++) {
                const payload = {
                    model: request.model,
                    messages: [{ role: 'user', content: prompt }],
                    ...(shape.omitTemperature ? {} : { temperature: getConfiguredTemperature() }),
                    [shape.tokenParam]: resolveMaxOutputTokens(options, attempt),
                };
                try {
                    data = await HttpUtils.postJson<OpenAIResponse>(
                        `${baseUrl}${path}`,
                        payload,
                        {
                            headers: HttpUtils.createRequestHeaders(
                                request.apiKey,
                                request.extraHeaders,
                            ),
                            signal: options?.signal,
                        },
                    );
                    break;
                } catch (error) {
                    const fixed = fixes < 2 ? fixPayloadFromError(error, shape) : undefined;
                    if (!fixed) {
                        throw error;
                    }
                    Logger.log(`${request.model} rejected request parameters, retrying with ${JSON.stringify(fixed)}`);
                    shape = fixed;
                    learnedShapes.set(shapeKey, shape);
                }
            }

            progress.report({ message: 'Processing generated message...', increment: 90 });

            const choice = data.choices?.[0];
            // `length` means the model ran out of `max_tokens` mid-message. Reasoning
            // models (DeepSeek `reasoner`, OpenAI o-series) spend that budget on
            // reasoning tokens, so they hit it long before the answer is finished.
            if (choice?.finish_reason === 'length') {
                throw new TruncatedResponseError(
                    request.providerLabel,
                    `${request.model} exhausted ${shape.tokenParam}`,
                );
            }

            const message = extractAndValidateMessage(
                choice?.message?.content,
                request.providerLabel,
            );
            Logger.log(`Commit message generated using ${request.model} model`);
            return { message, model: request.model };
        },
    );
}

/**
 * Per-provider variation for the OpenAI-compatible wire format. Everything an
 * individual provider used to express in its own `*Service.ts` wrapper now
 * lives as one row here; the shared dispatcher below reads it. Fields that are
 * identical for every provider (the `providerLabel` = catalog `displayName`,
 * the `<id>.model` setting key, the default `getApiKey` of `getKey(id)`, the
 * default `/chat/completions` path) are derived, not repeated.
 */
interface CompatProviderSpec {
    /** Endpoint base URL. A thunk because some read live config. */
    baseUrl: () => string;
    /** Provider-specific attribution/routing headers (e.g. OpenRouter). */
    extraHeaders?: Record<string, string>;
    /** Override the chat-completions path (e.g. user-configurable Custom). */
    chatCompletionsPath?: () => string;
    /** Override key acquisition (e.g. Custom's optional `useApiKey` toggle). */
    getApiKey?: () => Promise<string | undefined>;
    maxTokensParam?: TokenParam;
}

const COMPAT_SPECS: Partial<Record<Provider, CompatProviderSpec>> = {
    openai: {
        baseUrl: () => ConfigService.get('openai.baseUrl'),
        // `max_tokens` is deprecated on OpenAI and rejected by gpt-5/o-series;
        // `max_completion_tokens` works for every current OpenAI chat model.
        maxTokensParam: 'max_completion_tokens',
    },
    groq: { baseUrl: () => 'https://api.groq.com/openai/v1' },
    xai: { baseUrl: () => 'https://api.x.ai/v1' },
    deepseek: { baseUrl: () => 'https://api.deepseek.com' },
    codestral: { baseUrl: () => 'https://codestral.mistral.ai/v1' },
    // La Plateforme — the full Mistral catalog (mistral-large/medium/small,
    // magistral, ministral, …). Distinct from `codestral`, which is the
    // code-only endpoint with its own free-tier key.
    mistral: { baseUrl: () => 'https://api.mistral.ai/v1' },
    openrouter: {
        baseUrl: () => 'https://openrouter.ai/api/v1',
        extraHeaders: {
            // OpenRouter recommends these headers so usage shows up attributed
            // to the calling app on their dashboard.
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'HTTP-Referer': 'https://github.com/VizzleTF/CommitSage',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'X-Title': 'Commit Sage',
        },
    },
    custom: {
        // User-configured OpenAI-compatible endpoint (LM Studio, vLLM,
        // llama.cpp, LocalAI, Together, Fireworks, …). `apiKey` is optional:
        // self-hosted models often need no auth, so the key is only fetched
        // when the `custom.useApiKey` toggle is on.
        baseUrl: () => ConfigService.get('custom.baseUrl'),
        chatCompletionsPath: () => ConfigService.get('custom.chatCompletionsPath'),
        getApiKey: async () =>
            ConfigService.get('custom.useApiKey')
                ? ApiKeyManager.getKey('custom')
                : undefined,
    },
};

/** True when `provider` speaks the OpenAI `/chat/completions` wire format. */
export function isOpenAICompatibleProvider(provider: Provider): boolean {
    return provider in COMPAT_SPECS;
}

/**
 * Single entry point for every OpenAI-compatible provider. Replaces the seven
 * near-identical `*Service.ts` wrapper classes: looks up the provider's row in
 * `COMPAT_SPECS`, derives the rest from the catalog/settings, and delegates to
 * `generateViaOpenAICompatible`.
 */
export async function generateViaOpenAICompatibleProvider(
    provider: Provider,
    prompt: string,
    progress: ProgressReporter,
    attempt: number = 1,
    options?: GenerateOptions,
): Promise<CommitMessage> {
    const spec = COMPAT_SPECS[provider];
    if (!spec) {
        throw new Error(`Provider '${provider}' is not OpenAI-compatible`);
    }
    const apiKey = spec.getApiKey
        ? await spec.getApiKey()
        : await ApiKeyManager.getKey(provider);

    return generateViaOpenAICompatible(
        {
            providerLabel: providerMeta(provider).displayName,
            baseUrl: spec.baseUrl(),
            apiKey,
            model: ConfigService.getModelFor(provider),
            chatCompletionsPath: spec.chatCompletionsPath?.(),
            extraHeaders: spec.extraHeaders,
            maxTokensParam: spec.maxTokensParam,
        },
        prompt,
        progress,
        attempt,
        (p, pr, a) => generateViaOpenAICompatibleProvider(provider, p, pr, a, options),
        options,
    );
}
