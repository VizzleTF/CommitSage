import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockedGetJson } = vi.hoisted(() => ({ mockedGetJson: vi.fn() }));

vi.mock('../src/utils/httpUtils', async () => {
    const actual = await vi.importActual<typeof import('../src/utils/httpUtils')>(
        '../src/utils/httpUtils'
    );
    return {
        ...actual,
        HttpUtils: {
            createRequestHeaders: actual.HttpUtils.createRequestHeaders,
            stripTrailingSlashes: actual.HttpUtils.stripTrailingSlashes,
            getJson: mockedGetJson,
        },
    };
});

import {
    fetchOpenAIModels,
    fetchOllamaModels,
    fetchOpenAICompatModels,
    isFreeOpenRouterModel,
} from '../src/services/modelLists';

const bearer = (key: string): unknown =>
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${key}` }) });

beforeEach(() => {
    mockedGetJson.mockReset();
});

describe('fetchOpenAIModels ordering', () => {
    it('filters to chat-prefixed ids and orders longer (newer) first, lexicographic on ties', async () => {
        mockedGetJson.mockResolvedValue({
            data: [
                { id: 'gpt-4o' },
                { id: 'gpt-4o-2024-08-06' },
                { id: 'o1-mini' }, // length 7
                { id: 'o3-pro' },  // length 6, ties with gpt-4o -> lexicographic
                { id: 'text-embedding-3' }, // filtered out (no chat prefix)
                { id: '' },
            ],
        });
        const result = await fetchOpenAIModels('https://api.openai.test', 'key');
        // length desc: o1-mini (7) before the length-6 pair; within length 6,
        // lexicographic tiebreak puts gpt-4o before o3-pro.
        expect(result).toEqual(['gpt-4o-2024-08-06', 'o1-mini', 'gpt-4o', 'o3-pro']);
    });

    it('coerces an entry with no id to "" and drops it', async () => {
        mockedGetJson.mockResolvedValue({ data: [{}, { id: 'gpt-4o' }] });
        expect(await fetchOpenAIModels('https://api.openai.test', 'key')).toEqual(['gpt-4o']);
    });

    it('handles a missing data array', async () => {
        mockedGetJson.mockResolvedValue({});
        expect(await fetchOpenAIModels('https://api.openai.test', 'key')).toEqual([]);
    });
});

describe('fetchOllamaModels auth', () => {
    it('adds an Authorization header when an auth token is provided', async () => {
        mockedGetJson.mockResolvedValue({ models: [{ name: 'llama3' }, {}] });
        const result = await fetchOllamaModels('http://localhost:11434', 'tok');
        expect(result).toEqual(['llama3']);
        expect(mockedGetJson).toHaveBeenCalledWith(
            'http://localhost:11434/api/tags',
            bearer('tok'),
        );
    });

    it('handles a missing models array', async () => {
        mockedGetJson.mockResolvedValue({});
        expect(await fetchOllamaModels('http://localhost:11434')).toEqual([]);
    });

    it('dedupes and lexicographically sorts multiple model names (runs the comparator)', async () => {
        // >=2 distinct names so Array.prototype.sort actually invokes the
        // comparator (the single-element cases above skip it entirely).
        mockedGetJson.mockResolvedValue({
            models: [
                { name: 'qwen2.5' },
                { name: 'llama3' },
                { name: 'qwen2.5' }, // duplicate -> deduped
                { name: 'mistral' },
            ],
        });
        const result = await fetchOllamaModels('http://localhost:11434');
        expect(result).toEqual(['llama3', 'mistral', 'qwen2.5']);
    });
});

describe('OpenRouter free-model filter', () => {
    it('filters to free models when preferFreeModels is true', async () => {
        mockedGetJson.mockResolvedValue({
            data: [
                { id: 'a/model:free' },
                { id: 'b/zero', pricing: { prompt: '0', completion: '0' } },
                { id: 'c/paid', pricing: { prompt: '0.1', completion: '0.2' } },
                { id: '' },
                {}, // no id -> coerced to '' and dropped
            ],
        });
        const result = await fetchOpenAICompatModels('https://openrouter.ai/api/v1', 'key', isFreeOpenRouterModel);
        expect(result).toEqual(['a/model:free', 'b/zero']);
        expect(mockedGetJson).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/models',
            bearer('key'),
        );
    });

    it('returns all models (sorted, deduped) when preferFreeModels is false', async () => {
        mockedGetJson.mockResolvedValue({
            data: [{ id: 'z/paid' }, { id: 'a/free:free' }, { id: 'a/free:free' }],
        });
        const result = await fetchOpenAICompatModels('https://openrouter.ai/api/v1', 'key');
        expect(result).toEqual(['a/free:free', 'z/paid']);
    });

    it('handles a missing data array', async () => {
        mockedGetJson.mockResolvedValue({});
        expect(await fetchOpenAICompatModels('https://openrouter.ai/api/v1', 'key', isFreeOpenRouterModel)).toEqual([]);
    });
});

describe('fetchOpenAICompatModels', () => {
    it('maps + dedupes + sorts model ids from <baseUrl>/models', async () => {
        mockedGetJson.mockResolvedValue({
            data: [{ id: 'llama-3' }, { id: 'gemma' }, { id: 'llama-3' }, { id: '' }, {}],
        });
        const result = await fetchOpenAICompatModels('https://api.groq.com/openai/v1', 'key');
        expect(result).toEqual(['gemma', 'llama-3']);
        expect(mockedGetJson).toHaveBeenCalledWith(
            'https://api.groq.com/openai/v1/models',
            bearer('key'),
        );
    });

    it('handles a missing data array', async () => {
        mockedGetJson.mockResolvedValue({});
        expect(await fetchOpenAICompatModels('https://api.deepseek.com', 'key')).toEqual([]);
    });
});
