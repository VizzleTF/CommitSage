import { ConfigService } from '../utils/configService';
import { ApiKeyManager } from '../services/apiKeyManager';
import {
    fetchGeminiModels,
    fetchOpenAIModels,
    fetchCodestralModels,
    fetchOllamaModels,
    fetchOpenRouterModels,
    fetchGroqModels,
    fetchAnthropicModels,
    fetchDeepSeekModels,
    fetchXaiModels,
} from '../services/modelLists';
import { Provider } from '../views/webview/protocol';
import {
    PROVIDER_CATALOG,
    ProviderMeta,
    providerMeta as catalogMeta,
} from './providerCatalog';

export { PROVIDERS } from './providerCatalog';

/**
 * A provider's static metadata (from `providerCatalog.ts`) plus the runtime
 * behavior that needs config/secrets — kept here because, unlike the catalog,
 * this layer may import `ConfigService`/`ApiKeyManager`. The webview provider
 * iterates this table; everything else derives from the catalog.
 */
export interface ProviderDef extends ProviderMeta {
    /** Currently configured model id for this provider. */
    selectedModel(): string;
    /** Fetches the live model list, throwing if a required key is missing. */
    fetchModels(): Promise<string[]>;
}

async function requireKey(id: Provider, label: string): Promise<string> {
    const key = await ApiKeyManager.getOptionalKey(id);
    if (!key) {
        throw new Error(`${label} API key is not set`);
    }
    return key;
}

/** Per-provider runtime behavior, composed onto the catalog metadata below. */
const PROVIDER_BEHAVIOR: Record<Provider, Pick<ProviderDef, 'selectedModel' | 'fetchModels'>> = {
    gemini: {
        selectedModel: () => ConfigService.get('gemini.model'),
        fetchModels: async () => fetchGeminiModels(await requireKey('gemini', 'Gemini')),
    },
    openrouter: {
        selectedModel: () => ConfigService.get('openrouter.model'),
        fetchModels: async () => fetchOpenRouterModels(
            await requireKey('openrouter', 'OpenRouter'),
            ConfigService.get('openrouter.preferFreeModels'),
        ),
    },
    groq: {
        selectedModel: () => ConfigService.get('groq.model'),
        fetchModels: async () => fetchGroqModels(await requireKey('groq', 'Groq')),
    },
    anthropic: {
        selectedModel: () => ConfigService.get('anthropic.model'),
        // Anthropic has no public /models endpoint; the list is a static
        // fallback baked into modelLists.ts. We still gate on the key being set
        // so the UI surfaces the same "set a key" hint as the other providers.
        fetchModels: async () => fetchAnthropicModels(await requireKey('anthropic', 'Anthropic')),
    },
    openai: {
        selectedModel: () => ConfigService.get('openai.model'),
        fetchModels: async () => fetchOpenAIModels(
            await requireKey('openai', 'OpenAI'),
            ConfigService.get('openai.baseUrl'),
        ),
    },
    deepseek: {
        selectedModel: () => ConfigService.get('deepseek.model'),
        fetchModels: async () => fetchDeepSeekModels(await requireKey('deepseek', 'DeepSeek')),
    },
    xai: {
        selectedModel: () => ConfigService.get('xai.model'),
        fetchModels: async () => fetchXaiModels(await requireKey('xai', 'xAI')),
    },
    codestral: {
        selectedModel: () => ConfigService.get('codestral.model'),
        fetchModels: async () => fetchCodestralModels(await requireKey('codestral', 'Codestral')),
    },
    ollama: {
        selectedModel: () => ConfigService.get('ollama.model'),
        fetchModels: async () => {
            const useAuth = ConfigService.get('ollama.useAuthToken');
            const token = useAuth ? await ApiKeyManager.getOptionalKey('ollama') : undefined;
            return fetchOllamaModels(ConfigService.get('ollama.baseUrl'), token);
        },
    },
    custom: {
        selectedModel: () => ConfigService.get('custom.model'),
        // Custom has no listing endpoint — user types the model manually.
        // Returning an empty list lets the dropdown render just the configured model.
        fetchModels: async () => [],
    },
};

export const PROVIDER_DEFS: readonly ProviderDef[] = PROVIDER_CATALOG.map(meta => ({
    ...meta,
    ...PROVIDER_BEHAVIOR[meta.id],
}));

/** Providers with no live `/models` endpoint — the UI hides their refresh button. */
export const NO_REFRESH_PROVIDERS: readonly Provider[] = PROVIDER_DEFS
    .filter(d => d.noRefresh)
    .map(d => d.id);

const BY_ID = new Map<Provider, ProviderDef>(PROVIDER_DEFS.map(d => [d.id, d]));

export function providerDef(id: Provider): ProviderDef {
    const def = BY_ID.get(id);
    if (!def) {
        // Defer to the catalog's error for a consistent message / unknown-id guard.
        catalogMeta(id);
        throw new Error(`Unknown provider: ${id}`);
    }
    return def;
}

/** SecretStorage keys for all providers — used to react to key changes. */
export const SECRET_KEYS: readonly string[] = PROVIDER_DEFS.map(d => d.secretKey);

/** `{ provider: url }` for providers that expose a "get a key" console link. */
export const API_KEY_URLS: Partial<Record<Provider, string>> = Object.fromEntries(
    PROVIDER_DEFS.filter(d => d.apiKeyUrl).map(d => [d.id, d.apiKeyUrl]),
);

export const PROVIDER_LABELS = Object.fromEntries(
    PROVIDER_DEFS.map(d => [d.id, d.label]),
) as Record<Provider, string>;

export const PROVIDER_LIVE_SOURCES = Object.fromEntries(
    PROVIDER_DEFS.map(d => [d.id, d.liveSource]),
) as Record<Provider, string>;
