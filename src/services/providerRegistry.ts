import { ConfigService } from '../utils/configService';
import { ApiKeyManager } from '../services/apiKeyManager';
import {
    ModelEntry,
    fetchAnthropicModels,
    fetchCodestralModels,
    fetchOllamaModels,
    fetchOpenAICompatModels,
    fetchOpenAIModels,
    fetchXaiModels,
    isFreeOpenRouterModel,
    isMistralChatModel,
} from '../services/modelLists';
import { GeminiService } from './geminiService';
import { compatBaseUrl } from './openAICompatibleService';
import { Provider } from '../views/webview/protocol';
import {
    PROVIDER_CATALOG,
    ProviderMeta,
    providerMeta,
} from './providerCatalog';

export { PROVIDERS } from './providerCatalog';

/**
 * A provider's static metadata (from `providerCatalog.ts`) plus the runtime
 * behavior that needs config/secrets — kept here because, unlike the catalog,
 * this layer may import `ConfigService`/`ApiKeyManager`. The webview provider
 * iterates this table; everything else derives from the catalog.
 */
export interface ProviderDef extends ProviderMeta {
    /** Fetches the live model list, throwing if a required key is missing. */
    fetchModels(): Promise<string[]>;
}

async function requireKey(id: Provider): Promise<string> {
    const key = await ApiKeyManager.getOptionalKey(id);
    if (!key) {
        throw new Error(`${providerMeta(id).label} API key is not set`);
    }
    return key;
}

/** Model-list fetch for an OpenAI-compatible provider, from its chat base URL. */
function compatModels(id: Provider, keep?: (m: ModelEntry) => boolean): () => Promise<string[]> {
    return async () => fetchOpenAICompatModels(compatBaseUrl(id), await requireKey(id), keep);
}

/** Per-provider live model fetch, composed onto the catalog metadata below. */
const FETCH_MODELS: Record<Provider, () => Promise<string[]>> = {
    gemini: async () => GeminiService.getAvailableModels(await requireKey('gemini')),
    openrouter: async () => fetchOpenAICompatModels(
        compatBaseUrl('openrouter'),
        await requireKey('openrouter'),
        ConfigService.get('openrouter.preferFreeModels') ? isFreeOpenRouterModel : undefined,
    ),
    groq: compatModels('groq'),
    anthropic: async () => fetchAnthropicModels(await requireKey('anthropic')),
    openai: async () => fetchOpenAIModels(compatBaseUrl('openai'), await requireKey('openai')),
    deepseek: compatModels('deepseek'),
    xai: async () => fetchXaiModels(compatBaseUrl('xai'), await requireKey('xai')),
    // Static list; still gated on the key so the UI shows the same
    // "set a key" hint as the other providers.
    codestral: async () => {
        await requireKey('codestral');
        return fetchCodestralModels();
    },
    mistral: compatModels('mistral', isMistralChatModel),
    ollama: async () => {
        const useAuth = ConfigService.get('ollama.useAuthToken');
        const token = useAuth ? await ApiKeyManager.getOptionalKey('ollama') : undefined;
        return fetchOllamaModels(ConfigService.get('ollama.baseUrl'), token);
    },
    // Custom has no listing endpoint — user types the model manually.
    // Returning an empty list lets the dropdown render just the configured model.
    custom: async () => [],
};

export const PROVIDER_DEFS: readonly ProviderDef[] = PROVIDER_CATALOG.map(meta => ({
    ...meta,
    fetchModels: FETCH_MODELS[meta.id],
}));

/** Providers with no live `/models` endpoint — the UI hides their refresh button. */
export const NO_REFRESH_PROVIDERS: readonly Provider[] = PROVIDER_DEFS
    .filter(d => d.noRefresh)
    .map(d => d.id);

const BY_ID = new Map<Provider, ProviderDef>(PROVIDER_DEFS.map(d => [d.id, d]));

export function providerDef(id: Provider): ProviderDef {
    const def = BY_ID.get(id);
    if (!def) {
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
