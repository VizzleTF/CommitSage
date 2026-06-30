import { ApiKeyValidator } from '../utils/apiKeyValidator';
import { Provider } from '../views/webview/protocol';

/**
 * The single source of truth for static, per-provider facts. This is a *leaf*
 * module — it imports only the `Provider` type and the pure `ApiKeyValidator`,
 * never `ConfigService` or `ApiKeyManager`. That keeps it free of import
 * cycles so every other layer (providerRegistry, apiKeyManager, the
 * set/remove-key commands, configService) can derive from it instead of
 * re-declaring the same facts in parallel tables that silently drift.
 *
 * Runtime behavior that needs config/secrets (current model, live model fetch)
 * lives in `providerRegistry.ts`, which composes these metadata entries with
 * the closures it can only build at that layer.
 */
export interface ProviderMeta {
    id: Provider;
    /** Display name shown in the model picker (e.g. "Anthropic Claude"). */
    label: string;
    /**
     * Name used in API-key prompts ("Enter your {displayName} API Key").
     * Intentionally distinct from `label` — e.g. Gemini's key is a "Google"
     * key, and the picker says "xAI Grok" while the prompt says "xAI".
     */
    displayName: string;
    /** SecretStorage key holding this provider's API key / auth token. */
    secretKey: string;
    /** Command id that prompts for + stores this provider's key. */
    setCmd: string;
    /** Command id that clears this provider's key. */
    removeCmd: string;
    /** "Get a key" deep link; omitted for providers with no hosted console. */
    apiKeyUrl?: string;
    /** Human description of where the live model list comes from. */
    liveSource: string;
    /** True when there is no live `/models` endpoint (UI hides refresh). */
    noRefresh?: boolean;
    /** Validates a pasted key; returns an error string or null when valid. */
    validateKey: (key: string) => string | null;
}

const lax = ApiKeyValidator.validateNonEmpty;

export const PROVIDER_CATALOG: readonly ProviderMeta[] = [
    {
        id: 'gemini',
        label: 'Gemini',
        displayName: 'Google',
        secretKey: 'commitsage.apiKey',
        setCmd: 'commitsage.setApiKey',
        removeCmd: 'commitsage.removeApiKey',
        apiKeyUrl: 'https://aistudio.google.com/app/apikey',
        liveSource: 'Google Generative Language',
        validateKey: ApiKeyValidator.validateGeminiApiKey,
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        displayName: 'OpenRouter',
        secretKey: 'commitsage.openrouterApiKey',
        setCmd: 'commitsage.setOpenRouterApiKey',
        removeCmd: 'commitsage.removeOpenRouterApiKey',
        apiKeyUrl: 'https://openrouter.ai/keys',
        liveSource: 'OpenRouter /api/v1/models',
        validateKey: lax,
    },
    {
        id: 'groq',
        label: 'Groq',
        displayName: 'Groq',
        secretKey: 'commitsage.groqApiKey',
        setCmd: 'commitsage.setGroqApiKey',
        removeCmd: 'commitsage.removeGroqApiKey',
        apiKeyUrl: 'https://console.groq.com/keys',
        liveSource: 'Groq /openai/v1/models',
        validateKey: lax,
    },
    {
        id: 'anthropic',
        label: 'Anthropic Claude',
        displayName: 'Anthropic',
        secretKey: 'commitsage.anthropicApiKey',
        setCmd: 'commitsage.setAnthropicApiKey',
        removeCmd: 'commitsage.removeAnthropicApiKey',
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
        liveSource: 'Static list (Anthropic has no public /models endpoint)',
        noRefresh: true,
        validateKey: lax,
    },
    {
        id: 'openai',
        label: 'OpenAI',
        displayName: 'OpenAI',
        secretKey: 'commitsage.openaiApiKey',
        setCmd: 'commitsage.setOpenAIApiKey',
        removeCmd: 'commitsage.removeOpenAIApiKey',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        liveSource: 'OpenAI /v1/models (gpt-* / o-series)',
        validateKey: lax,
    },
    {
        id: 'deepseek',
        label: 'DeepSeek',
        displayName: 'DeepSeek',
        secretKey: 'commitsage.deepseekApiKey',
        setCmd: 'commitsage.setDeepSeekApiKey',
        removeCmd: 'commitsage.removeDeepSeekApiKey',
        apiKeyUrl: 'https://platform.deepseek.com/api_keys',
        liveSource: 'DeepSeek /models',
        validateKey: lax,
    },
    {
        id: 'xai',
        label: 'xAI Grok',
        displayName: 'xAI',
        secretKey: 'commitsage.xaiApiKey',
        setCmd: 'commitsage.setXaiApiKey',
        removeCmd: 'commitsage.removeXaiApiKey',
        apiKeyUrl: 'https://console.x.ai/',
        liveSource: 'xAI /v1/models',
        validateKey: lax,
    },
    {
        id: 'codestral',
        label: 'Codestral',
        displayName: 'Codestral',
        secretKey: 'commitsage.codestralApiKey',
        setCmd: 'commitsage.setCodestralApiKey',
        removeCmd: 'commitsage.removeCodestralApiKey',
        apiKeyUrl: 'https://console.mistral.ai/codestral',
        liveSource: 'Mistral published Codestral aliases (static — no list API)',
        noRefresh: true,
        validateKey: ApiKeyValidator.validateCodestralApiKey,
    },
    {
        id: 'ollama',
        label: 'Ollama',
        displayName: 'Ollama',
        secretKey: 'commitsage.ollamaAuthToken',
        setCmd: 'commitsage.setOllamaAuthToken',
        removeCmd: 'commitsage.removeOllamaAuthToken',
        // no hosted console — local
        liveSource: '/api/tags (local)',
        validateKey: lax,
    },
    {
        id: 'custom',
        label: 'Custom (OpenAI-compatible)',
        displayName: 'Custom',
        secretKey: 'commitsage.customApiKey',
        setCmd: 'commitsage.setCustomApiKey',
        removeCmd: 'commitsage.removeCustomApiKey',
        // no listing endpoint, no console
        liveSource: 'Free-form — type the model your endpoint exposes',
        noRefresh: true,
        validateKey: lax,
    },
] as const;

/** Provider ids in display order. */
export const PROVIDERS: readonly Provider[] = PROVIDER_CATALOG.map(d => d.id);

const META_BY_ID = new Map<Provider, ProviderMeta>(
    PROVIDER_CATALOG.map(d => [d.id, d]),
);

/** Look up a provider's metadata, throwing for an unknown id. */
export function providerMeta(id: Provider): ProviderMeta {
    const meta = META_BY_ID.get(id);
    if (!meta) {
        throw new Error(`Unknown provider: ${id}`);
    }
    return meta;
}

/** Type guard: is `value` a known provider id? */
export function isProvider(value: string): value is Provider {
    return META_BY_ID.has(value as Provider);
}
