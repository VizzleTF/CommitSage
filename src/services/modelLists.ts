import { HttpUtils } from '../utils/httpUtils';
import { GeminiService } from './geminiService';

/**
 * Live model lists per provider, used by the settings webview to populate the
 * model dropdown without relying on stale static enums. Each function returns
 * a list of model IDs and throws on transport/auth/HTTP errors — the caller
 * (`SettingsWebviewProvider`) translates the error into a UI string.
 *
 * Gemini delegates to the existing implementation in `GeminiService` to avoid
 * duplicating the quality-tier sort.
 */

export async function fetchGeminiModels(
    apiKey: string,
    signal?: AbortSignal,
): Promise<string[]> {
    return GeminiService.getAvailableModels(apiKey, signal);
}

interface OpenAIModelsResponse {
    data?: Array<{ id?: string }>;
}

const OPENAI_CHAT_PREFIXES = ['gpt-', 'chatgpt-', 'o1', 'o3', 'o4'];

export async function fetchOpenAIModels(
    apiKey: string,
    baseUrl: string,
    signal?: AbortSignal,
): Promise<string[]> {
    const trimmed = baseUrl.replace(/\/+$/, '');
    const data = await HttpUtils.getJson<OpenAIModelsResponse>(`${trimmed}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
    });

    const ids = (data.data ?? [])
        .map(m => m.id ?? '')
        .filter(id => id && OPENAI_CHAT_PREFIXES.some(p => id.startsWith(p)));

    // Heuristic newest-first ordering: longer suffix usually means newer
    // (`gpt-4o-2024-08-06` > `gpt-4o`), then lexicographic as a tiebreaker.
    // Avoids hardcoding a hierarchy that decays the moment OpenAI adds a model.
    return [...new Set(ids)].sort((a, b) => {
        const lenDiff = b.length - a.length;
        return lenDiff !== 0 ? lenDiff : a.localeCompare(b);
    });
}

// Codestral has no programmatic model listing on its dedicated subdomain
// (`codestral.mistral.ai/v1/models` → 404). The main `api.mistral.ai/v1/models`
// would work but requires a different API key (la Plateforme key, not the
// codestral.mistral.ai key the user enters here). So we ship a static
// fallback list of the model aliases Mistral publishes for the Codestral
// endpoint. Keep this list in sync with https://docs.mistral.ai/getting-started/models/.
const CODESTRAL_KNOWN_MODELS = [
    'codestral-latest',
    'codestral-2508',
    'codestral-2501',
    'codestral-2405',
];

export async function fetchCodestralModels(
    _apiKey: string,
    _signal?: AbortSignal,
): Promise<string[]> {
    return [...CODESTRAL_KNOWN_MODELS];
}

interface OllamaTagsResponse {
    models?: Array<{ name?: string }>;
}

export async function fetchOllamaModels(
    baseUrl: string,
    authToken?: string,
    signal?: AbortSignal,
): Promise<string[]> {
    const trimmed = baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    const data = await HttpUtils.getJson<OllamaTagsResponse>(`${trimmed}/api/tags`, {
        headers,
        signal,
    });

    const names = (data.models ?? [])
        .map(m => m.name ?? '')
        .filter(Boolean);

    return [...new Set(names)].sort();
}
