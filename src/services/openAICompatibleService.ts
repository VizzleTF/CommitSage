import { Logger } from '../utils/logger';
import type { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { extractAndValidateMessage, getConfiguredTemperature, resolveMaxOutputTokens, sendWithThinkingLadder, ThinkingLadder, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpError, HttpUtils } from '../utils/httpUtils';
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
    /** Sent when `general.disableThinking` is on; see `sendWithThinkingLadder`. */
    thinkingOff?: ThinkingLadder;
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
    options?: GenerateOptions,
): Promise<CommitMessage> {
    return withRetryAndApiKeyGuard(
        request.providerLabel,
        progress,
        async attempt => {
            const path = request.chatCompletionsPath ?? '/chat/completions';
            const baseUrl = HttpUtils.stripTrailingSlashes(request.baseUrl);

            const shapeKey = `${baseUrl}|${request.model}`;
            let shape: PayloadShape = learnedShapes.get(shapeKey) ?? {
                tokenParam: request.maxTokensParam ?? 'max_tokens',
                omitTemperature: false,
            };

            const temperature = getConfiguredTemperature();
            // The thinking ladder wraps the shape fixes: a 400 they don't
            // recognize may be about the thinking fragment.
            const data = await sendWithThinkingLadder(shapeKey, request.thinkingOff ?? [], async thinking => {
                // At most two corrections (token field + temperature), then the error stands.
                for (let fixes = 0; ; fixes++) {
                    const payload = {
                        model: request.model,
                        messages: [{ role: 'user', content: prompt }],
                        ...(shape.omitTemperature || temperature === undefined ? {} : { temperature }),
                        [shape.tokenParam]: resolveMaxOutputTokens(options, attempt),
                        ...thinking,
                    };
                    try {
                        return await HttpUtils.postJson<OpenAIResponse>(
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
            });

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
            return { message, model: request.model };
        },
        { signal: options?.signal },
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
    /** How to switch thinking off; none means the provider has no switch. */
    thinkingOff?: ThinkingLadder;
}

// OpenAI `reasoning_effort` values from the least thinking up; the API notes
// that not every reasoning model supports every value.
const REASONING_EFFORT_LADDER: ThinkingLadder = [
    // eslint-disable-next-line @typescript-eslint/naming-convention
    { reasoning_effort: 'none' },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    { reasoning_effort: 'minimal' },
    // eslint-disable-next-line @typescript-eslint/naming-convention
    { reasoning_effort: 'low' },
];

const COMPAT_SPECS: Partial<Record<Provider, CompatProviderSpec>> = {
    openai: {
        // A URL without a scheme makes fetch throw "Invalid URL", which reads
        // as a network error; assume https like the settings listener used to.
        baseUrl: () => {
            const url = ConfigService.get('openai.baseUrl').trim();
            return !url || /^https?:\/\//i.test(url) ? url : `https://${url}`;
        },
        // `max_tokens` is deprecated on OpenAI and rejected by gpt-5/o-series;
        // `max_completion_tokens` works for every current OpenAI chat model.
        maxTokensParam: 'max_completion_tokens',
        thinkingOff: REASONING_EFFORT_LADDER,
    },
    // Qwen3 takes `none`; gpt-oss only `low`/`medium`/`high`, other values are a 400.
    groq: {
        baseUrl: () => 'https://api.groq.com/openai/v1',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        thinkingOff: [{ reasoning_effort: 'none' }, { reasoning_effort: 'low' }],
    },
    // grok-4.5+ cannot disable reasoning; `low` is their least effort.
    xai: {
        baseUrl: () => 'https://api.x.ai/v1',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        thinkingOff: [{ reasoning_effort: 'low' }],
    },
    deepseek: {
        baseUrl: () => 'https://api.deepseek.com',
        thinkingOff: [{ thinking: { type: 'disabled' } }],
    },
    codestral: { baseUrl: () => 'https://codestral.mistral.ai/v1' },
    // La Plateforme — the full Mistral catalog (mistral-large/medium/small,
    // magistral, ministral, …). Distinct from `codestral`, which is the
    // code-only endpoint with its own free-tier key.
    mistral: {
        baseUrl: () => 'https://api.mistral.ai/v1',
        // `none`: "thinks minimally", no thinking chunk (mistral-small, medium-3-5, large-4-0).
        // eslint-disable-next-line @typescript-eslint/naming-convention
        thinkingOff: [{ reasoning_effort: 'none' }],
    },
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
        // OpenRouter's unified `reasoning` field; `effort: low` for models
        // that cannot turn reasoning off.
        thinkingOff: [{ reasoning: { enabled: false } }, { reasoning: { effort: 'low' } }],
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
        // vLLM documents this chat-template switch for Qwen3.
        // eslint-disable-next-line @typescript-eslint/naming-convention
        thinkingOff: [{ chat_template_kwargs: { enable_thinking: false } }],
    },
};

/** True when `provider` speaks the OpenAI `/chat/completions` wire format. */
export function isOpenAICompatibleProvider(provider: Provider): boolean {
    return provider in COMPAT_SPECS;
}

function compatSpec(provider: Provider): CompatProviderSpec {
    const spec = COMPAT_SPECS[provider];
    if (!spec) {
        throw new Error(`Provider '${provider}' is not OpenAI-compatible`);
    }
    return spec;
}

/** API base URL of an OpenAI-compatible provider; its model list is `<base>/models`. */
export function compatBaseUrl(provider: Provider): string {
    return compatSpec(provider).baseUrl();
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
    options?: GenerateOptions,
): Promise<CommitMessage> {
    const spec = compatSpec(provider);
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
            thinkingOff: spec.thinkingOff,
        },
        prompt,
        progress,
        options,
    );
}
