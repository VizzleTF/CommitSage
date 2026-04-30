import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedPost = vi.mocked(axios.post);

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: {
        getKey: vi.fn(async () => 'test-key'),
        getOptionalKey: vi.fn(async () => undefined),
    },
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        getOpenAIModel: () => 'gpt-test',
        getOpenAIBaseUrl: () => 'https://api.openai.com/v1',
        getCodestralModel: () => 'codestral-latest',
        getOllamaModel: () => 'llama3.2',
        getOllamaBaseUrl: () => 'http://localhost:11434',
        getGeminiModel: () => 'gemini-2.5-flash',
        getApiRequestTimeout: () => 30,
    },
}));

vi.mock('../src/utils/retryUtils', () => ({
    RetryUtils: {
        updateProgressForAttempt: vi.fn(async () => undefined),
        handleGenerationError: vi.fn(async (err: Error) => {
            throw err;
        }),
    },
}));

const progress = { report: () => undefined };

beforeEach(() => {
    mockedPost.mockReset();
});

describe('OpenAIService payload', () => {
    it('sends max_tokens (snake_case), not maxTokens', async () => {
        const { OpenAIService } = await import('../src/services/openaiService');

        mockedPost.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'feat: ok' } }] },
        });

        await OpenAIService.generateCommitMessage('hello', progress, 1, {
            maxTokens: 4096,
        });

        expect(mockedPost).toHaveBeenCalledTimes(1);
        const [, payload] = mockedPost.mock.calls[0];
        expect(payload).toMatchObject({
            model: 'gpt-test',
            // F001 regression guard
            max_tokens: 4096,
        });
        expect(payload).not.toHaveProperty('maxTokens');
    });

    it('defaults max_tokens to 1024 when no options', async () => {
        const { OpenAIService } = await import('../src/services/openaiService');

        mockedPost.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'ok' } }] },
        });

        await OpenAIService.generateCommitMessage('hi', progress, 1);
        const [, payload] = mockedPost.mock.calls[0];
        expect(payload).toMatchObject({ max_tokens: 1024 });
    });
});

describe('CodestralService payload', () => {
    it('uses Codestral chat completions URL', async () => {
        const { CodestralService } = await import('../src/services/codestralService');

        mockedPost.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'feat: ok' } }] },
        });

        await CodestralService.generateCommitMessage('hello', progress, 1);
        expect(mockedPost).toHaveBeenCalledTimes(1);
        const [url, payload] = mockedPost.mock.calls[0];
        expect(url).toBe('https://codestral.mistral.ai/v1/chat/completions');
        expect(payload).toMatchObject({
            model: 'codestral-latest',
            messages: [{ role: 'user', content: 'hello' }],
        });
        // No maxTokens passed → no max_tokens in payload (default behaviour)
        expect(payload).not.toHaveProperty('max_tokens');
    });

    it('forwards maxTokens as max_tokens (snake_case) when provided', async () => {
        const { CodestralService } = await import('../src/services/codestralService');

        mockedPost.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'ok' } }] },
        });

        await CodestralService.generateCommitMessage('hi', progress, 1, {
            maxTokens: 4096,
        });
        const [, payload] = mockedPost.mock.calls[0];
        // F009 regression guard
        expect(payload).toMatchObject({ max_tokens: 4096 });
        expect(payload).not.toHaveProperty('maxTokens');
    });
});

describe('OllamaService payload', () => {
    it('targets /api/chat with stream=false', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');

        mockedPost.mockResolvedValueOnce({
            data: { message: { content: 'feat: ok' } },
        });

        await OllamaService.generateCommitMessage('hello', progress, 1);
        const [url, payload] = mockedPost.mock.calls[0];
        expect(url).toBe('http://localhost:11434/api/chat');
        expect(payload).toMatchObject({
            model: 'llama3.2',
            stream: false,
        });
        expect(payload).not.toHaveProperty('options');
    });

    it('forwards maxTokens as options.num_predict when provided (F009)', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');

        mockedPost.mockResolvedValueOnce({
            data: { message: { content: 'ok' } },
        });

        await OllamaService.generateCommitMessage('hi', progress, 1, {
            maxTokens: 4096,
        });
        const [, payload] = mockedPost.mock.calls[0];
        expect(payload).toMatchObject({
            options: { num_predict: 4096 },
        });
    });
});

describe('GeminiService request', () => {
    it('does not put apiKey in URL; sends x-goog-api-key header', async () => {
        const { GeminiService } = await import('../src/services/geminiService');

        mockedPost.mockResolvedValueOnce({
            data: {
                candidates: [{ content: { parts: [{ text: 'feat: ok' }] } }],
            },
        });

        await GeminiService.generateCommitMessage('hello', progress, 1);

        const [url, , config] = mockedPost.mock.calls[0];
        expect(typeof url).toBe('string');
        expect(url as string).not.toContain('?key=');
        expect(url as string).not.toContain('test-key');

        const headers = (config as { headers?: Record<string, string> })?.headers ?? {};
        expect(headers['x-goog-api-key']).toBe('test-key');
    });
});

describe('AbortSignal propagation (F004)', () => {
    it('forwards options.signal into axios.post for OpenAI', async () => {
        const { OpenAIService } = await import('../src/services/openaiService');
        mockedPost.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'ok' } }] },
        });

        const ctrl = new AbortController();
        await OpenAIService.generateCommitMessage('hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , config] = mockedPost.mock.calls[0];
        expect((config as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });

    it('forwards options.signal into axios.post for Codestral', async () => {
        const { CodestralService } = await import('../src/services/codestralService');
        mockedPost.mockResolvedValueOnce({
            data: { choices: [{ message: { content: 'ok' } }] },
        });

        const ctrl = new AbortController();
        await CodestralService.generateCommitMessage('hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , config] = mockedPost.mock.calls[0];
        expect((config as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });

    it('forwards options.signal into axios.post for Ollama', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        mockedPost.mockResolvedValueOnce({
            data: { message: { content: 'ok' } },
        });

        const ctrl = new AbortController();
        await OllamaService.generateCommitMessage('hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , config] = mockedPost.mock.calls[0];
        expect((config as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });

    it('forwards options.signal into axios.post for Gemini', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedPost.mockResolvedValueOnce({
            data: {
                candidates: [{ content: { parts: [{ text: 'ok' }] } }],
            },
        });

        const ctrl = new AbortController();
        await GeminiService.generateCommitMessage('hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , config] = mockedPost.mock.calls[0];
        expect((config as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });
});
