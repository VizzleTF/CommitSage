import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedPostJson = vi.fn();
const mockedGetJson = vi.fn();

vi.mock('../src/utils/httpUtils', async () => {
    // Re-export the real HttpError/NetworkError so tests can throw them.
    const actual = await vi.importActual<typeof import('../src/utils/httpUtils')>(
        '../src/utils/httpUtils'
    );
    return {
        ...actual,
        HttpUtils: {
            createRequestHeaders: actual.HttpUtils.createRequestHeaders,
            postJson: mockedPostJson,
            getJson: mockedGetJson,
        },
    };
});

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: {
        getKey: vi.fn(async () => 'test-key'),
        getOptionalKey: vi.fn(async () => undefined),
    },
}));

const SETTINGS: Record<string, string | number | boolean> = {
    'openai.model': 'gpt-test',
    'openai.baseUrl': 'https://api.openai.com/v1',
    'codestral.model': 'codestral-latest',
    'ollama.model': 'llama3.2',
    'ollama.baseUrl': 'http://localhost:11434',
    'gemini.model': 'gemini-2.5-flash',
    'apiRequestTimeout': 30,
    'general.maxRetries': 3,
};

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => SETTINGS[key],
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
    mockedPostJson.mockReset();
    mockedGetJson.mockReset();
});

describe('OpenAIService payload', () => {
    it('sends max_tokens (snake_case), not maxTokens', async () => {
        const { OpenAIService } = await import('../src/services/openaiService');

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await OpenAIService.generateCommitMessage('hello', progress, 1, {
            maxTokens: 4096,
        });

        expect(mockedPostJson).toHaveBeenCalledTimes(1);
        const [, payload] = mockedPostJson.mock.calls[0];
        expect(payload).toMatchObject({
            model: 'gpt-test',
            // F001 regression guard
            max_tokens: 4096,
        });
        expect(payload).not.toHaveProperty('maxTokens');
    });

    it('defaults max_tokens to 1024 when no options', async () => {
        const { OpenAIService } = await import('../src/services/openaiService');

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        await OpenAIService.generateCommitMessage('hi', progress, 1);
        const [, payload] = mockedPostJson.mock.calls[0];
        expect(payload).toMatchObject({ max_tokens: 1024 });
    });
});

describe('CodestralService payload', () => {
    it('uses Codestral chat completions URL', async () => {
        const { CodestralService } = await import('../src/services/codestralService');

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await CodestralService.generateCommitMessage('hello', progress, 1);
        expect(mockedPostJson).toHaveBeenCalledTimes(1);
        const [url, payload] = mockedPostJson.mock.calls[0];
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

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        await CodestralService.generateCommitMessage('hi', progress, 1, {
            maxTokens: 4096,
        });
        const [, payload] = mockedPostJson.mock.calls[0];
        // F009 regression guard
        expect(payload).toMatchObject({ max_tokens: 4096 });
        expect(payload).not.toHaveProperty('maxTokens');
    });
});

describe('OllamaService payload', () => {
    it('targets /api/chat with stream=false', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');

        mockedPostJson.mockResolvedValueOnce({
            message: { content: 'feat: ok' },
        });

        await OllamaService.generateCommitMessage('hello', progress, 1);
        const [url, payload] = mockedPostJson.mock.calls[0];
        expect(url).toBe('http://localhost:11434/api/chat');
        expect(payload).toMatchObject({
            model: 'llama3.2',
            stream: false,
        });
        expect(payload).not.toHaveProperty('options');
    });

    it('forwards maxTokens as options.num_predict when provided (F009)', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');

        mockedPostJson.mockResolvedValueOnce({
            message: { content: 'ok' },
        });

        await OllamaService.generateCommitMessage('hi', progress, 1, {
            maxTokens: 4096,
        });
        const [, payload] = mockedPostJson.mock.calls[0];
        expect(payload).toMatchObject({
            options: { num_predict: 4096 },
        });
    });

    it('throws ApiKeyInvalidError on HTTP 401 (F037)', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        const { ApiKeyInvalidError } = await import('../src/models/errors');
        const { HttpError } = await import('../src/utils/httpUtils');

        mockedPostJson.mockRejectedValueOnce(new HttpError(401, {}));

        await expect(
            OllamaService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeInstanceOf(ApiKeyInvalidError);
    });
});

describe('GeminiService request', () => {
    it('does not put apiKey in URL; sends x-goog-api-key header', async () => {
        const { GeminiService } = await import('../src/services/geminiService');

        mockedPostJson.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ text: 'feat: ok' }] } }],
        });

        await GeminiService.generateCommitMessage('hello', progress, 1);

        const [url, , opts] = mockedPostJson.mock.calls[0];
        expect(typeof url).toBe('string');
        expect(url as string).not.toContain('?key=');
        expect(url as string).not.toContain('test-key');

        const headers = (opts as { headers?: Record<string, string> })?.headers ?? {};
        expect(headers['x-goog-api-key']).toBe('test-key');
    });
});

describe('AbortSignal propagation (F004)', () => {
    it('forwards options.signal into HttpUtils.postJson for OpenAI', async () => {
        const { OpenAIService } = await import('../src/services/openaiService');
        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        const ctrl = new AbortController();
        await OpenAIService.generateCommitMessage('hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , opts] = mockedPostJson.mock.calls[0];
        expect((opts as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });

    it('forwards options.signal into HttpUtils.postJson for Codestral', async () => {
        const { CodestralService } = await import('../src/services/codestralService');
        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        const ctrl = new AbortController();
        await CodestralService.generateCommitMessage('hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , opts] = mockedPostJson.mock.calls[0];
        expect((opts as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });

    it('forwards options.signal into HttpUtils.postJson for Ollama', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        mockedPostJson.mockResolvedValueOnce({
            message: { content: 'ok' },
        });

        const ctrl = new AbortController();
        await OllamaService.generateCommitMessage('hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , opts] = mockedPostJson.mock.calls[0];
        expect((opts as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });

    it('forwards options.signal into HttpUtils.postJson for Gemini', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedPostJson.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        });

        const ctrl = new AbortController();
        await GeminiService.generateCommitMessage('hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , opts] = mockedPostJson.mock.calls[0];
        expect((opts as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });
});
