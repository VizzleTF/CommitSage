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

/**
 * Shared fetcher for any provider exposing the OpenAI `/models` endpoint
 * shape (`{data: [{id}, ...]}`). Used by OpenAI, Groq, DeepSeek, xAI.
 * `filter` is optional — defaults to "include all non-empty ids".
 */
async function fetchOpenAICompatModels(
    url: string,
    apiKey: string,
    signal?: AbortSignal,
    filter?: (id: string) => boolean,
): Promise<string[]> {
    const data = await HttpUtils.getJson<OpenAIModelsResponse>(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
    });

    const ids = (data.data ?? [])
        .map(m => m.id ?? '')
        .filter(id => id && (!filter || filter(id)));

    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

const OPENAI_CHAT_PREFIXES = ['gpt-', 'chatgpt-', 'o1', 'o3', 'o4'];

export async function fetchOpenAIModels(
    apiKey: string,
    baseUrl: string,
    signal?: AbortSignal,
): Promise<string[]> {
    const trimmed = HttpUtils.stripTrailingSlashes(baseUrl);
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
        return lenDiff === 0 ? a.localeCompare(b) : lenDiff;
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
    const trimmed = HttpUtils.stripTrailingSlashes(baseUrl);
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

    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

interface OpenRouterModelsResponse {
    data?: Array<{
        id?: string;
        pricing?: {
            prompt?: string;
            completion?: string;
        };
    }>;
}

/**
 * OpenRouter `/api/v1/models` returns 300+ models. The webview filters to
 * free models by default (per `commitSage.openrouter.preferFreeModels`) to
 * keep the dropdown usable. Free = `:free` suffix OR zero prompt+completion
 * pricing (covers gift-promo models that don't use the suffix convention).
 */
export async function fetchOpenRouterModels(
    apiKey: string,
    preferFreeModels: boolean,
    signal?: AbortSignal,
): Promise<string[]> {
    const data = await HttpUtils.getJson<OpenRouterModelsResponse>(
        'https://openrouter.ai/api/v1/models',
        {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
        },
    );

    const all = (data.data ?? [])
        .map(m => ({
            id: m.id ?? '',
            isFree:
                (m.id ?? '').endsWith(':free') ||
                (m.pricing?.prompt === '0' && m.pricing?.completion === '0'),
        }))
        .filter(m => m.id);

    const filtered = preferFreeModels ? all.filter(m => m.isFree) : all;
    return [...new Set(filtered.map(m => m.id))].sort((a, b) => a.localeCompare(b));
}

export async function fetchGroqModels(
    apiKey: string,
    signal?: AbortSignal,
): Promise<string[]> {
    return fetchOpenAICompatModels(
        'https://api.groq.com/openai/v1/models',
        apiKey,
        signal,
    );
}

export async function fetchDeepSeekModels(
    apiKey: string,
    signal?: AbortSignal,
): Promise<string[]> {
    return fetchOpenAICompatModels(
        'https://api.deepseek.com/models',
        apiKey,
        signal,
    );
}

// xAI hides `/v1/models` behind team-credit gating (403 with "Your newly
// created team doesn't have any credits or licenses yet" until a credit
// pack or license is purchased — even though the listing endpoint itself
// has no per-call cost). Falling back to a curated list keeps the picker
// usable on fresh accounts; inference still gates on credits separately.
// Keep this list in sync with https://docs.x.ai/docs/models.
const XAI_KNOWN_MODELS = [
    'grok-4-1-fast',
    'grok-4-fast',
    'grok-4-fast-non-reasoning',
    'grok-3',
    'grok-3-mini',
    'grok-code-fast-1',
];

export async function fetchXaiModels(
    apiKey: string,
    signal?: AbortSignal,
): Promise<string[]> {
    try {
        const live = await fetchOpenAICompatModels(
            'https://api.x.ai/v1/models',
            apiKey,
            signal,
        );
        return live.length > 0 ? live : [...XAI_KNOWN_MODELS];
    } catch (error) {
        // Team-blocked / no-credits accounts can't read `/v1/models`. Treat
        // any non-cancellation failure as "fall back to static list" rather
        // than leaving the dropdown empty — the user can still hand-pick a
        // model they have credits for. Cancellation must propagate so the
        // UI doesn't paint a stale list after a user-initiated abort.
        if (signal?.aborted) {
            throw error;
        }
        return [...XAI_KNOWN_MODELS];
    }
}

// Anthropic does not expose a public /models endpoint that an end-user API key
// can hit. Keep this list in sync with https://docs.anthropic.com/en/docs/about-claude/models.
const ANTHROPIC_KNOWN_MODELS = [
    'claude-opus-4-1-20250805',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
];

export async function fetchAnthropicModels(
    _apiKey: string,
    _signal?: AbortSignal,
): Promise<string[]> {
    return [...ANTHROPIC_KNOWN_MODELS];
}
