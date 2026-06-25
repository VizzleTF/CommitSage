import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockGet,
    mockGetOptionalKey,
    fetchGeminiModels,
    fetchOpenAIModels,
    fetchCodestralModels,
    fetchOllamaModels,
    fetchOpenRouterModels,
    fetchGroqModels,
    fetchAnthropicModels,
    fetchDeepSeekModels,
    fetchXaiModels,
} = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockGetOptionalKey: vi.fn(),
    fetchGeminiModels: vi.fn(),
    fetchOpenAIModels: vi.fn(),
    fetchCodestralModels: vi.fn(),
    fetchOllamaModels: vi.fn(),
    fetchOpenRouterModels: vi.fn(),
    fetchGroqModels: vi.fn(),
    fetchAnthropicModels: vi.fn(),
    fetchDeepSeekModels: vi.fn(),
    fetchXaiModels: vi.fn(),
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: { get: mockGet },
}));

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: { getOptionalKey: mockGetOptionalKey },
}));

vi.mock('../src/services/modelLists', () => ({
    fetchGeminiModels,
    fetchOpenAIModels,
    fetchCodestralModels,
    fetchOllamaModels,
    fetchOpenRouterModels,
    fetchGroqModels,
    fetchAnthropicModels,
    fetchDeepSeekModels,
    fetchXaiModels,
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
    fetchGeminiModels.mockResolvedValue(['g']);
    fetchOpenAIModels.mockResolvedValue(['o']);
    fetchCodestralModels.mockResolvedValue(['c']);
    fetchOllamaModels.mockResolvedValue(['ol']);
    fetchOpenRouterModels.mockResolvedValue(['or']);
    fetchGroqModels.mockResolvedValue(['gr']);
    fetchAnthropicModels.mockResolvedValue(['an']);
    fetchDeepSeekModels.mockResolvedValue(['ds']);
    fetchXaiModels.mockResolvedValue(['x']);
});

describe('providerRegistry derived exports', () => {
    it('PROVIDERS lists ids in display order', () => {
        expect(PROVIDERS).toEqual([
            'gemini', 'openrouter', 'groq', 'anthropic', 'openai',
            'deepseek', 'xai', 'codestral', 'ollama', 'custom',
        ]);
    });

    it('NO_REFRESH_PROVIDERS contains only providers flagged noRefresh', () => {
        expect([...NO_REFRESH_PROVIDERS].sort()).toEqual(
            ['anthropic', 'codestral', 'custom'].sort(),
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

describe('selectedModel() reads config per provider', () => {
    it.each([
        ['gemini', 'gemini.model'],
        ['openrouter', 'openrouter.model'],
        ['groq', 'groq.model'],
        ['anthropic', 'anthropic.model'],
        ['openai', 'openai.model'],
        ['deepseek', 'deepseek.model'],
        ['xai', 'xai.model'],
        ['codestral', 'codestral.model'],
        ['ollama', 'ollama.model'],
        ['custom', 'custom.model'],
    ])('%s reads %s', (id, key) => {
        mockGet.mockImplementation((k: string) => (k === key ? 'the-model' : undefined));
        expect(providerDef(id as never).selectedModel()).toBe('the-model');
        expect(mockGet).toHaveBeenCalledWith(key);
    });
});

describe('fetchModels() success paths', () => {
    it('gemini passes the resolved key', async () => {
        expect(await providerDef('gemini').fetchModels()).toEqual(['g']);
        expect(fetchGeminiModels).toHaveBeenCalledWith('a-key');
    });

    it('openrouter passes key and preferFreeModels', async () => {
        mockGet.mockImplementation((k: string) => (k === 'openrouter.preferFreeModels' ? true : undefined));
        expect(await providerDef('openrouter').fetchModels()).toEqual(['or']);
        expect(fetchOpenRouterModels).toHaveBeenCalledWith('a-key', true);
    });

    it('groq passes the key', async () => {
        expect(await providerDef('groq').fetchModels()).toEqual(['gr']);
        expect(fetchGroqModels).toHaveBeenCalledWith('a-key');
    });

    it('anthropic passes the key', async () => {
        expect(await providerDef('anthropic').fetchModels()).toEqual(['an']);
        expect(fetchAnthropicModels).toHaveBeenCalledWith('a-key');
    });

    it('openai passes key and baseUrl', async () => {
        mockGet.mockImplementation((k: string) => (k === 'openai.baseUrl' ? 'https://x' : undefined));
        expect(await providerDef('openai').fetchModels()).toEqual(['o']);
        expect(fetchOpenAIModels).toHaveBeenCalledWith('a-key', 'https://x');
    });

    it('deepseek passes the key', async () => {
        expect(await providerDef('deepseek').fetchModels()).toEqual(['ds']);
        expect(fetchDeepSeekModels).toHaveBeenCalledWith('a-key');
    });

    it('xai passes the key', async () => {
        expect(await providerDef('xai').fetchModels()).toEqual(['x']);
        expect(fetchXaiModels).toHaveBeenCalledWith('a-key');
    });

    it('codestral passes the key', async () => {
        expect(await providerDef('codestral').fetchModels()).toEqual(['c']);
        expect(fetchCodestralModels).toHaveBeenCalledWith('a-key');
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
        ['anthropic', 'Anthropic'],
        ['openai', 'OpenAI'],
        ['deepseek', 'DeepSeek'],
        ['xai', 'xAI'],
        ['codestral', 'Codestral'],
    ])('%s throws when key is missing', async (id, label) => {
        mockGetOptionalKey.mockResolvedValue(undefined);
        await expect(providerDef(id as never).fetchModels()).rejects.toThrow(
            `${label} API key is not set`,
        );
    });
});
