import { HttpUtils } from '../utils/httpUtils';
import { ANTHROPIC_VERSION } from './anthropicService';

/**
 * Live model lists per provider, used by the settings webview to populate the
 * model dropdown without relying on stale static enums. Each function returns
 * a list of model IDs and throws on transport/auth/HTTP errors — the caller
 * (`SettingsWebviewProvider`) translates the error into a UI string.
 *
 * Gemini's list comes from `GeminiService.getAvailableModels`, which also
 * feeds its auto mode.
 */

/** One entry of an OpenAI-shaped `/models` listing (`{data: [{id, ...}]}`). */
export interface ModelEntry {
    id?: string;
    archived?: boolean;
    capabilities?: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        completion_chat?: boolean;
    };
    pricing?: {
        prompt?: string;
        completion?: string;
    };
}

function sortedUnique(ids: string[]): string[] {
    return [...new Set(ids.filter(id => id !== ''))].sort((a, b) => a.localeCompare(b));
}

async function fetchModelIds(
    url: string,
    headers: Record<string, string>,
    keep: (m: ModelEntry) => boolean = () => true,
): Promise<string[]> {
    const data = await HttpUtils.getJson<{ data?: ModelEntry[] }>(url, { headers });
    return sortedUnique((data.data ?? []).filter(keep).map(m => m.id ?? ''));
}

/**
 * Model list of any provider that mirrors OpenAI's Bearer-authenticated
 * `GET <baseUrl>/models` (Groq, DeepSeek, xAI, Mistral, OpenRouter, OpenAI).
 * `keep` narrows the entries; the ids come back deduped and sorted.
 */
export function fetchOpenAICompatModels(
    baseUrl: string,
    apiKey: string,
    keep?: (m: ModelEntry) => boolean,
): Promise<string[]> {
    return fetchModelIds(
        `${HttpUtils.stripTrailingSlashes(baseUrl)}/models`,
        HttpUtils.createRequestHeaders(apiKey),
        keep,
    );
}

const OPENAI_CHAT_PREFIXES = ['gpt-', 'chatgpt-', 'o1', 'o3', 'o4'];

export async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const ids = await fetchOpenAICompatModels(
        baseUrl,
        apiKey,
        m => OPENAI_CHAT_PREFIXES.some(p => m.id?.startsWith(p)),
    );

    // Heuristic newest-first ordering: longer suffix usually means newer
    // (`gpt-4o-2024-08-06` > `gpt-4o`), then lexicographic as a tiebreaker.
    // Avoids hardcoding a hierarchy that decays the moment OpenAI adds a model.
    return ids.sort((a, b) => b.length - a.length || a.localeCompare(b));
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
];

export function fetchCodestralModels(): string[] {
    return [...CODESTRAL_KNOWN_MODELS];
}

/**
 * Mistral La Plateforme (`api.mistral.ai`) — the full catalog, unlike the
 * `codestral` provider whose dedicated subdomain serves code models only and
 * has no listing endpoint. Chat-only: the response also carries embedding,
 * OCR, moderation and FIM models, which cannot answer `/chat/completions`.
 * Archived (deprecated) models are dropped for the same reason.
 */
export function isMistralChatModel(m: ModelEntry): boolean {
    // `!== false` rather than `=== true`: a model entry without the
    // capabilities block is kept instead of silently vanishing from the
    // picker if Mistral changes the payload.
    return m.capabilities?.completion_chat !== false && m.archived !== true;
}

/**
 * OpenRouter `/api/v1/models` returns 300+ models. The webview filters to
 * free models by default (per `commitSage.openrouter.preferFreeModels`) to
 * keep the dropdown usable. Free = `:free` suffix OR zero prompt+completion
 * pricing (covers gift-promo models that don't use the suffix convention).
 */
export function isFreeOpenRouterModel(m: ModelEntry): boolean {
    return (m.id ?? '').endsWith(':free') ||
        (m.pricing?.prompt === '0' && m.pricing?.completion === '0');
}

interface OllamaTagsResponse {
    models?: Array<{ name?: string }>;
}

export async function fetchOllamaModels(
    baseUrl: string,
    authToken?: string,
): Promise<string[]> {
    const data = await HttpUtils.getJson<OllamaTagsResponse>(
        `${HttpUtils.stripTrailingSlashes(baseUrl)}/api/tags`,
        { headers: HttpUtils.createRequestHeaders(authToken) },
    );
    return sortedUnique((data.models ?? []).map(m => m.name ?? ''));
}

// xAI hides `/v1/models` behind team-credit gating (403 with "Your newly
// created team doesn't have any credits or licenses yet" until a credit
// pack or license is purchased — even though the listing endpoint itself
// has no per-call cost). Falling back to a curated list keeps the picker
// usable on fresh accounts; inference still gates on credits separately.
// Keep this list in sync with https://docs.x.ai/docs/models.
const XAI_KNOWN_MODELS = [
    'grok-4.7',
    'grok-4.6',
    'grok-4.5',
    'grok-4.3',
    'grok-4.20-0309-reasoning',
    'grok-4.20-0309-non-reasoning',
    'grok-build-0.1',
];

export async function fetchXaiModels(baseUrl: string, apiKey: string): Promise<string[]> {
    try {
        const live = await fetchOpenAICompatModels(baseUrl, apiKey);
        return live.length > 0 ? live : [...XAI_KNOWN_MODELS];
    } catch {
        // Team-blocked / no-credits accounts can't read `/v1/models`. Fall
        // back to the static list rather than leaving the dropdown empty —
        // the user can still hand-pick a model they have credits for.
        return [...XAI_KNOWN_MODELS];
    }
}

/**
 * Anthropic's `GET /v1/models` answers in the OpenAI shape (`{data: [{id}]}`)
 * but authenticates like the Messages API (`x-api-key` + `anthropic-version`).
 * It pages at 20 entries by default, so ask for the largest page.
 */
export function fetchAnthropicModels(apiKey: string): Promise<string[]> {
    return fetchModelIds(
        'https://api.anthropic.com/v1/models?limit=1000',
        HttpUtils.createRequestHeaders(
            apiKey,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            { 'anthropic-version': ANTHROPIC_VERSION },
            'x-api-key',
        ),
    );
}
