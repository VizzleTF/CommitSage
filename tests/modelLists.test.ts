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
    fetchOpenAICompatModels,
    fetchOllamaModels,
    fetchXaiModels,
    fetchAnthropicModels,
    fetchCodestralModels,
    isMistralChatModel,
} from '../src/services/modelLists';

describe('modelLists trailing-slash handling', () => {
    beforeEach(() => mockedGetJson.mockReset());

    it('strips trailing slashes from the OpenAI base URL before requesting', async () => {
        mockedGetJson.mockResolvedValue({ data: [{ id: 'gpt-4o' }] });
        await fetchOpenAIModels('https://api.openai.test///', 'key');
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

describe('modelLists static fallbacks', () => {
    beforeEach(() => mockedGetJson.mockReset());

    it('fetchXaiModels falls back to the static list when the live list is empty', async () => {
        mockedGetJson.mockResolvedValueOnce({ data: [] });
        const result = await fetchXaiModels('https://api.x.ai/v1', 'key');
        expect(result).toContain('grok-4.3');
        expect(result.length).toBeGreaterThan(0);
    });

    it('fetchXaiModels falls back to the static list when the request fails', async () => {
        mockedGetJson.mockRejectedValueOnce(new Error('boom'));
        await expect(fetchXaiModels('https://api.x.ai/v1', 'key')).resolves.toContain('grok-4.3');
    });

    it('fetchCodestralModels returns the static known-models list', () => {
        expect(fetchCodestralModels()).toContain('codestral-latest');
    });
});

describe('fetchAnthropicModels', () => {
    beforeEach(() => mockedGetJson.mockReset());

    it('reads the live /v1/models list with x-api-key auth and a full page', async () => {
        mockedGetJson.mockResolvedValue({
            data: [
                { id: 'claude-sonnet-x', type: 'model', display_name: 'Sonnet' },
                { id: 'claude-haiku-x', type: 'model' },
                { id: 'claude-sonnet-x' },
            ],
            has_more: false,
        });

        await expect(fetchAnthropicModels('key')).resolves.toEqual(['claude-haiku-x', 'claude-sonnet-x']);

        const [url, opts] = mockedGetJson.mock.calls[0];
        // The endpoint pages at 20 by default.
        expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
        expect(opts.headers['x-api-key']).toBe('key');
        expect(opts.headers['anthropic-version']).toBe('2023-06-01');
        expect(opts.headers.Authorization).toBeUndefined();
    });
});

describe('Mistral chat-model filter', () => {
    beforeEach(() => {
        mockedGetJson.mockReset();
    });

    it('lists chat models from La Plateforme, sorted and deduped', async () => {
        mockedGetJson.mockResolvedValue({
            data: [
                { id: 'mistral-small-latest', capabilities: { completion_chat: true } },
                { id: 'mistral-large-latest', capabilities: { completion_chat: true } },
                { id: 'mistral-small-latest', capabilities: { completion_chat: true } },
                // No capabilities block at all — kept, so a payload change can't
                // empty the picker.
                { id: 'magistral-medium-latest' },
            ],
        });

        await expect(fetchOpenAICompatModels('https://api.mistral.ai/v1', 'key', isMistralChatModel)).resolves.toEqual([
            'magistral-medium-latest',
            'mistral-large-latest',
            'mistral-small-latest',
        ]);

        const [url, opts] = mockedGetJson.mock.calls[0];
        expect(url).toBe('https://api.mistral.ai/v1/models');
        expect(opts.headers.Authorization).toBe('Bearer key');
    });

    it('drops non-chat and archived models', async () => {
        mockedGetJson.mockResolvedValue({
            data: [
                { id: 'mistral-small-latest', capabilities: { completion_chat: true } },
                { id: 'mistral-embed', capabilities: { completion_chat: false } },
                { id: 'codestral-2405', capabilities: { completion_chat: true }, archived: true },
                { id: '' },
            ],
        });

        await expect(fetchOpenAICompatModels('https://api.mistral.ai/v1', 'key', isMistralChatModel))
            .resolves.toEqual(['mistral-small-latest']);
    });
});
