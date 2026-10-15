import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockGet,
    mockGetOptionalKey,
    getAvailableModels,
    fetchOpenAIModels,
    fetchOpenAICompatModels,
    fetchCodestralModels,
    fetchOllamaModels,
    fetchAnthropicModels,
    fetchXaiModels,
    isFreeOpenRouterModel,
    isMistralChatModel,
} = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockGetOptionalKey: vi.fn(),
    getAvailableModels: vi.fn(),
    fetchOpenAIModels: vi.fn(),
    fetchOpenAICompatModels: vi.fn(),
    fetchCodestralModels: vi.fn(),
    fetchOllamaModels: vi.fn(),
    fetchAnthropicModels: vi.fn(),
    fetchXaiModels: vi.fn(),
    isFreeOpenRouterModel: vi.fn(),
    isMistralChatModel: vi.fn(),
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: { get: mockGet },
}));

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: { getOptionalKey: mockGetOptionalKey },
}));

vi.mock('../src/services/geminiService', () => ({
    GeminiService: { getAvailableModels },
}));

vi.mock('../src/services/modelLists', () => ({
    fetchOpenAIModels,
    fetchOpenAICompatModels,
    fetchCodestralModels,
    fetchOllamaModels,
    fetchAnthropicModels,
    fetchXaiModels,
    isFreeOpenRouterModel,
    isMistralChatModel,
}));

import {
    PROVIDER_DEFS,
    PROVIDERS,
    NO_REFRESH_PROVIDERS,
    SECRET_KEYS,
    API_KEY_URLS,
    PROVIDER_LABELS,
    PROVIDER_LIVE_SOURCES,
    providerDef,
} from '../src/services/providerRegistry';

beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue(undefined);
    mockGetOptionalKey.mockResolvedValue('a-key');
    getAvailableModels.mockResolvedValue(['g']);
    fetchOpenAIModels.mockResolvedValue(['o']);
    fetchOpenAICompatModels.mockResolvedValue(['compat']);
    fetchCodestralModels.mockReturnValue(['c']);
    fetchOllamaModels.mockResolvedValue(['ol']);
    fetchAnthropicModels.mockResolvedValue(['an']);
    fetchXaiModels.mockResolvedValue(['x']);
});

describe('providerRegistry derived exports', () => {
    it('PROVIDERS lists ids in display order', () => {
        expect(PROVIDERS).toEqual([
            'gemini', 'openrouter', 'groq', 'anthropic', 'openai',
            'deepseek', 'xai', 'codestral', 'mistral', 'ollama', 'custom',
        ]);
    });

    it('NO_REFRESH_PROVIDERS contains only providers flagged noRefresh', () => {
        expect([...NO_REFRESH_PROVIDERS].sort()).toEqual(
            ['codestral', 'custom'].sort(),
        );
    });

    it('SECRET_KEYS lists every secret key', () => {
        expect(SECRET_KEYS).toContain('commitsage.apiKey');
        expect(SECRET_KEYS).toHaveLength(PROVIDER_DEFS.length);
    });

    it('API_KEY_URLS only includes providers with a console link', () => {
        expect(API_KEY_URLS.gemini).toBe('https://aistudio.google.com/app/apikey');
        // ollama and custom have no apiKeyUrl
        expect(API_KEY_URLS.ollama).toBeUndefined();
        expect(API_KEY_URLS.custom).toBeUndefined();
    });

    it('PROVIDER_LABELS maps id to label', () => {
        expect(PROVIDER_LABELS.gemini).toBe('Gemini');
        expect(PROVIDER_LABELS.custom).toBe('Custom (OpenAI-compatible)');
    });

    it('PROVIDER_LIVE_SOURCES maps id to liveSource', () => {
        expect(PROVIDER_LIVE_SOURCES.gemini).toBe('Google Generative Language');
        expect(PROVIDER_LIVE_SOURCES.ollama).toBe('/api/tags (local)');
    });
});

describe('providerDef()', () => {
    it('returns the def for a known id', () => {
        expect(providerDef('gemini').id).toBe('gemini');
    });

    it('throws for an unknown id', () => {
        expect(() => providerDef('nope' as never)).toThrow(/Unknown provider: nope/);
    });
});

describe('fetchModels() success paths', () => {
    it('gemini passes the resolved key', async () => {
        expect(await providerDef('gemini').fetchModels()).toEqual(['g']);
        expect(getAvailableModels).toHaveBeenCalledWith('a-key');
    });

    it('openrouter filters to free models when preferFreeModels is on', async () => {
        mockGet.mockImplementation((k: string) => (k === 'openrouter.preferFreeModels' ? true : undefined));
        expect(await providerDef('openrouter').fetchModels()).toEqual(['compat']);
        expect(fetchOpenAICompatModels).toHaveBeenCalledWith('https://openrouter.ai/api/v1', 'a-key', isFreeOpenRouterModel);
    });

    it('openrouter lists every model when preferFreeModels is off', async () => {
        await providerDef('openrouter').fetchModels();
        expect(fetchOpenAICompatModels).toHaveBeenCalledWith('https://openrouter.ai/api/v1', 'a-key', undefined);
    });

    it.each([
        ['groq', 'https://api.groq.com/openai/v1'],
        ['deepseek', 'https://api.deepseek.com'],
    ])('%s lists <chat base URL>/models with the key', async (id, baseUrl) => {
        expect(await providerDef(id as never).fetchModels()).toEqual(['compat']);
        expect(fetchOpenAICompatModels).toHaveBeenCalledWith(baseUrl, 'a-key', undefined);
    });

    it('mistral keeps chat models only', async () => {
        expect(await providerDef('mistral').fetchModels()).toEqual(['compat']);
        expect(fetchOpenAICompatModels).toHaveBeenCalledWith('https://api.mistral.ai/v1', 'a-key', isMistralChatModel);
    });

    it('anthropic passes the key', async () => {
        expect(await providerDef('anthropic').fetchModels()).toEqual(['an']);
        expect(fetchAnthropicModels).toHaveBeenCalledWith('a-key');
    });

    it('openai passes the configured baseUrl and key', async () => {
        mockGet.mockImplementation((k: string) => (k === 'openai.baseUrl' ? 'https://x' : undefined));
        expect(await providerDef('openai').fetchModels()).toEqual(['o']);
        expect(fetchOpenAIModels).toHaveBeenCalledWith('https://x', 'a-key');
    });

    it('xai passes its base URL and the key', async () => {
        expect(await providerDef('xai').fetchModels()).toEqual(['x']);
        expect(fetchXaiModels).toHaveBeenCalledWith('https://api.x.ai/v1', 'a-key');
    });

    it('codestral returns the static list once a key is set', async () => {
        expect(await providerDef('codestral').fetchModels()).toEqual(['c']);
        expect(mockGetOptionalKey).toHaveBeenCalledWith('codestral');
    });

    it('ollama with auth token enabled passes baseUrl + token', async () => {
        mockGet.mockImplementation((k: string) => {
            if (k === 'ollama.useAuthToken') return true;
            if (k === 'ollama.baseUrl') return 'http://localhost:11434';
            return undefined;
        });
        mockGetOptionalKey.mockResolvedValue('tok');
        expect(await providerDef('ollama').fetchModels()).toEqual(['ol']);
        expect(fetchOllamaModels).toHaveBeenCalledWith('http://localhost:11434', 'tok');
    });

    it('ollama without auth token passes undefined token and does not require a key', async () => {
        mockGet.mockImplementation((k: string) => {
            if (k === 'ollama.useAuthToken') return false;
            if (k === 'ollama.baseUrl') return 'http://localhost:11434';
            return undefined;
        });
        expect(await providerDef('ollama').fetchModels()).toEqual(['ol']);
        expect(fetchOllamaModels).toHaveBeenCalledWith('http://localhost:11434', undefined);
        expect(mockGetOptionalKey).not.toHaveBeenCalled();
    });

    it('custom returns an empty list without calling any fetcher', async () => {
        expect(await providerDef('custom').fetchModels()).toEqual([]);
    });
});

describe('fetchModels() missing-key throws (requireKey)', () => {
    it.each([
        ['gemini', 'Gemini'],
        ['openrouter', 'OpenRouter'],
        ['groq', 'Groq'],
        ['anthropic', 'Anthropic Claude'],
        ['openai', 'OpenAI'],
        ['deepseek', 'DeepSeek'],
        ['xai', 'xAI Grok'],
        ['codestral', 'Codestral'],
        ['mistral', 'Mistral'],
    ])('%s throws when key is missing', async (id, label) => {
        // Real settings always hold a string base URL (defaults included).
        mockGet.mockImplementation((k: string) => (k === 'openai.baseUrl' ? 'https://api.openai.com/v1' : undefined));
        mockGetOptionalKey.mockResolvedValue(undefined);
        await expect(providerDef(id as never).fetchModels()).rejects.toThrow(
            `${label} API key is not set`,
        );
    });
});
