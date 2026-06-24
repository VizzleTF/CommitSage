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

/**
 * Single source of truth for everything that varies per provider. Previously
 * these facts lived in six parallel maps (secret keys, set/remove commands,
 * key URLs, labels, live-source labels) plus a `fetchByProvider` switch, so
 * adding a provider meant editing six places that silently drifted. One entry
 * here now adds a provider; the webview provider iterates this table.
 */
export interface ProviderDef {
    id: Provider;
    /** Display name shown in the provider picker. */
    label: string;
    /** SecretStorage key — used to react to Set/Remove key changes. */
    secretKey: string;
    /** Command that prompts for + stores this provider's key/token. */
    setCmd: string;
    /** Command that clears this provider's key/token. */
    removeCmd: string;
    /** "Get a key" deep link; omitted for providers with no hosted console. */
    apiKeyUrl?: string;
    /** Human description of where the live model list comes from. */
    liveSource: string;
    /** True when there is no live `/models` endpoint, so the UI hides the
     *  refresh button (static fallback or user-supplied list). */
    noRefresh?: boolean;
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

export const PROVIDER_DEFS: readonly ProviderDef[] = [
    {
        id: 'gemini',
        label: 'Gemini',
        secretKey: 'commitsage.apiKey',
        setCmd: 'commitsage.setApiKey',
        removeCmd: 'commitsage.removeApiKey',
        apiKeyUrl: 'https://aistudio.google.com/app/apikey',
        liveSource: 'Google Generative Language',
        selectedModel: () => ConfigService.get('gemini.model'),
        fetchModels: async () => fetchGeminiModels(await requireKey('gemini', 'Gemini')),
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        secretKey: 'commitsage.openrouterApiKey',
        setCmd: 'commitsage.setOpenRouterApiKey',
        removeCmd: 'commitsage.removeOpenRouterApiKey',
        apiKeyUrl: 'https://openrouter.ai/keys',
        liveSource: 'OpenRouter /api/v1/models',
        selectedModel: () => ConfigService.get('openrouter.model'),
        fetchModels: async () => fetchOpenRouterModels(
            await requireKey('openrouter', 'OpenRouter'),
            ConfigService.get('openrouter.preferFreeModels'),
        ),
    },
    {
        id: 'groq',
        label: 'Groq',
        secretKey: 'commitsage.groqApiKey',
        setCmd: 'commitsage.setGroqApiKey',
        removeCmd: 'commitsage.removeGroqApiKey',
        apiKeyUrl: 'https://console.groq.com/keys',
        liveSource: 'Groq /openai/v1/models',
        selectedModel: () => ConfigService.get('groq.model'),
        fetchModels: async () => fetchGroqModels(await requireKey('groq', 'Groq')),
    },
    {
        id: 'anthropic',
        label: 'Anthropic Claude',
        secretKey: 'commitsage.anthropicApiKey',
        setCmd: 'commitsage.setAnthropicApiKey',
        removeCmd: 'commitsage.removeAnthropicApiKey',
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
        liveSource: 'Static list (Anthropic has no public /models endpoint)',
        noRefresh: true,
        selectedModel: () => ConfigService.get('anthropic.model'),
        // Anthropic has no public /models endpoint; the list is a static
        // fallback baked into modelLists.ts. We still gate on the key being set
        // so the UI surfaces the same "set a key" hint as the other providers.
        fetchModels: async () => fetchAnthropicModels(await requireKey('anthropic', 'Anthropic')),
    },
    {
        id: 'openai',
        label: 'OpenAI',
        secretKey: 'commitsage.openaiApiKey',
        setCmd: 'commitsage.setOpenAIApiKey',
        removeCmd: 'commitsage.removeOpenAIApiKey',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        liveSource: 'OpenAI /v1/models (gpt-* / o-series)',
        selectedModel: () => ConfigService.get('openai.model'),
        fetchModels: async () => fetchOpenAIModels(
            await requireKey('openai', 'OpenAI'),
            ConfigService.get('openai.baseUrl'),
        ),
    },
    {
        id: 'deepseek',
        label: 'DeepSeek',
        secretKey: 'commitsage.deepseekApiKey',
        setCmd: 'commitsage.setDeepSeekApiKey',
        removeCmd: 'commitsage.removeDeepSeekApiKey',
        apiKeyUrl: 'https://platform.deepseek.com/api_keys',
        liveSource: 'DeepSeek /models',
        selectedModel: () => ConfigService.get('deepseek.model'),
        fetchModels: async () => fetchDeepSeekModels(await requireKey('deepseek', 'DeepSeek')),
    },
    {
        id: 'xai',
        label: 'xAI Grok',
        secretKey: 'commitsage.xaiApiKey',
        setCmd: 'commitsage.setXaiApiKey',
        removeCmd: 'commitsage.removeXaiApiKey',
        apiKeyUrl: 'https://console.x.ai/',
        liveSource: 'xAI /v1/models',
        selectedModel: () => ConfigService.get('xai.model'),
        fetchModels: async () => fetchXaiModels(await requireKey('xai', 'xAI')),
    },
    {
        id: 'codestral',
        label: 'Codestral',
        secretKey: 'commitsage.codestralApiKey',
        setCmd: 'commitsage.setCodestralApiKey',
        removeCmd: 'commitsage.removeCodestralApiKey',
        apiKeyUrl: 'https://console.mistral.ai/codestral',
        liveSource: 'Mistral published Codestral aliases (static — no list API)',
        noRefresh: true,
        selectedModel: () => ConfigService.get('codestral.model'),
        fetchModels: async () => fetchCodestralModels(await requireKey('codestral', 'Codestral')),
    },
    {
        id: 'ollama',
        label: 'Ollama',
        secretKey: 'commitsage.ollamaAuthToken',
        setCmd: 'commitsage.setOllamaAuthToken',
        removeCmd: 'commitsage.removeOllamaAuthToken',
        // no hosted console — local
        liveSource: '/api/tags (local)',
        selectedModel: () => ConfigService.get('ollama.model'),
        fetchModels: async () => {
            const useAuth = ConfigService.get('ollama.useAuthToken');
            const token = useAuth ? await ApiKeyManager.getOptionalKey('ollama') : undefined;
            return fetchOllamaModels(ConfigService.get('ollama.baseUrl'), token);
        },
    },
    {
        id: 'custom',
        label: 'Custom (OpenAI-compatible)',
        secretKey: 'commitsage.customApiKey',
        setCmd: 'commitsage.setCustomApiKey',
        removeCmd: 'commitsage.removeCustomApiKey',
        // no listing endpoint, no console
        liveSource: 'Free-form — type the model your endpoint exposes',
        noRefresh: true,
        selectedModel: () => ConfigService.get('custom.model'),
        // Custom has no listing endpoint — user types the model manually.
        // Returning an empty list lets the dropdown render just the configured model.
        fetchModels: async () => [],
    },
] as const;

/** Provider ids in display order. */
export const PROVIDERS: readonly Provider[] = PROVIDER_DEFS.map(d => d.id);

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
