import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockedGetJson } = vi.hoisted(() => ({ mockedGetJson: vi.fn() }));

vi.mock('../src/utils/httpUtils', async () => {
    const actual = await vi.importActual<typeof import('../src/utils/httpUtils')>(
        '../src/utils/httpUtils'
    );
    return {
        ...actual,
        HttpUtils: {
            stripTrailingSlashes: actual.HttpUtils.stripTrailingSlashes,
            getJson: mockedGetJson,
        },
    };
});

vi.mock('../src/services/geminiService', () => ({
    GeminiService: {},
}));

import { fetchOpenAIModels, fetchOllamaModels } from '../src/services/modelLists';

describe('modelLists trailing-slash handling', () => {
    beforeEach(() => mockedGetJson.mockReset());

    it('strips trailing slashes from the OpenAI base URL before requesting', async () => {
        mockedGetJson.mockResolvedValue({ data: [{ id: 'gpt-4o' }] });
        await fetchOpenAIModels('key', 'https://api.openai.test///');
        expect(mockedGetJson).toHaveBeenCalledWith(
            'https://api.openai.test/models',
            expect.anything(),
        );
    });

    it('strips trailing slashes from the Ollama base URL before requesting', async () => {
        mockedGetJson.mockResolvedValue({ models: [{ name: 'llama3' }] });
        const result = await fetchOllamaModels('http://localhost:11434/');
        expect(mockedGetJson).toHaveBeenCalledWith(
            'http://localhost:11434/api/tags',
            expect.anything(),
        );
        expect(result).toEqual(['llama3']);
    });
});
