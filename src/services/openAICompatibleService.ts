import { Logger } from '../utils/logger';
import type { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { extractAndValidateMessage, getConfiguredTemperature, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ConfigService } from '../utils/configService';
import { ApiKeyManager } from './apiKeyManager';
import { providerMeta } from './providerCatalog';
import { Provider } from '../views/webview/protocol';

interface OpenAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
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

            const payload = {
                model: request.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: getConfiguredTemperature(),
                // eslint-disable-next-line @typescript-eslint/naming-convention
                max_tokens: options?.maxTokens ?? 1024,
            };

            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const data = await HttpUtils.postJson<OpenAIResponse>(
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

            progress.report({ message: 'Processing generated message...', increment: 90 });

            const message = extractAndValidateMessage(
                data.choices?.[0]?.message?.content,
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
}

const COMPAT_SPECS: Partial<Record<Provider, CompatProviderSpec>> = {
    openai: { baseUrl: () => ConfigService.get('openai.baseUrl') },
    groq: { baseUrl: () => 'https://api.groq.com/openai/v1' },
    xai: { baseUrl: () => 'https://api.x.ai/v1' },
    deepseek: { baseUrl: () => 'https://api.deepseek.com' },
    codestral: { baseUrl: () => 'https://codestral.mistral.ai/v1' },
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
        },
        prompt,
        progress,
        attempt,
        (p, pr, a) => generateViaOpenAICompatibleProvider(provider, p, pr, a, options),
        options,
    );
}
