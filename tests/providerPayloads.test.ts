import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Loaded lazily in beforeAll: a static import would force module resolution
// during vi.mock hoisting, before the mocked-fn consts below are initialized.
let generateViaOpenAICompatibleProvider:
    typeof import('../src/services/openAICompatibleService')['generateViaOpenAICompatibleProvider'];

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
            stripTrailingSlashes: actual.HttpUtils.stripTrailingSlashes,
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
    'openrouter.model': 'meta-llama/llama-3.3-70b-instruct:free',
    'openrouter.preferFreeModels': false,
    'groq.model': 'llama-3.3-70b-versatile',
    'anthropic.model': 'claude-sonnet-4-5-20250929',
    'deepseek.model': 'deepseek-chat',
    'xai.model': 'grok-3-mini',
    'custom.baseUrl': 'http://localhost:1234/v1',
    'custom.model': 'qwen2.5-coder',
    'custom.useApiKey': false,
    'custom.chatCompletionsPath': '/chat/completions',
    'general.temperature': 0.7,
    'ollama.numCtx': 0,
    'apiRequestTimeout': 30,
    'general.maxRetries': 3,
};

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => SETTINGS[key],
        getModelFor: (provider: string) => SETTINGS[`${provider}.model`],
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

beforeAll(async () => {
    ({ generateViaOpenAICompatibleProvider } = await import('../src/services/openAICompatibleService'));
});

beforeEach(() => {
    mockedPostJson.mockReset();
    mockedGetJson.mockReset();
});

describe('OpenAIService payload', () => {
    it('sends max_tokens (snake_case), not maxTokens', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await generateViaOpenAICompatibleProvider('openai', 'hello', progress, 1, {
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

    it('defaults max_tokens to general.maxOutputTokens when no options', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        await generateViaOpenAICompatibleProvider('openai', 'hi', progress, 1);
        const [, payload] = mockedPostJson.mock.calls[0];
        expect(payload).toMatchObject({ max_tokens: 4096 });
    });
});

describe('CodestralService payload', () => {
    it('uses Codestral chat completions URL', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await generateViaOpenAICompatibleProvider('codestral', 'hello', progress, 1);
        expect(mockedPostJson).toHaveBeenCalledTimes(1);
        const [url, payload] = mockedPostJson.mock.calls[0];
        expect(url).toBe('https://codestral.mistral.ai/v1/chat/completions');
        expect(payload).toMatchObject({
            model: 'codestral-latest',
            messages: [{ role: 'user', content: 'hello' }],
        });
        // Codestral now goes through the shared OpenAI-compatible path, which
        // defaults max_tokens to `general.maxOutputTokens` (matching its
        // OpenAI-shaped siblings).
        expect(payload).toMatchObject({ max_tokens: 4096 });
    });

    it('forwards maxTokens as max_tokens (snake_case) when provided', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        await generateViaOpenAICompatibleProvider('codestral', 'hi', progress, 1, {
            maxTokens: 4096,
        });
        const [, payload] = mockedPostJson.mock.calls[0];
        // F009 regression guard
        expect(payload).toMatchObject({ max_tokens: 4096 });
        expect(payload).not.toHaveProperty('maxTokens');
    });
});

describe('OllamaService payload', () => {
    it('targets /api/chat with stream=false and default temperature in options', async () => {
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
            // num_predict always carries the shared output budget
            options: { temperature: 0.7, num_predict: 4096 },
        });
        // num_ctx omitted when general default (0)
        expect((payload as { options: Record<string, unknown> }).options).not.toHaveProperty('num_ctx');
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
            options: { num_predict: 4096, temperature: 0.7 },
        });
    });

    it('forwards ollama.numCtx as options.num_ctx when > 0', async () => {
        SETTINGS['ollama.numCtx'] = 16384;
        const { OllamaService } = await import('../src/services/ollamaService');

        mockedPostJson.mockResolvedValueOnce({
            message: { content: 'ok' },
        });

        await OllamaService.generateCommitMessage('hi', progress, 1);
        const [, payload] = mockedPostJson.mock.calls[0];
        expect(payload).toMatchObject({
            options: { num_ctx: 16384, temperature: 0.7 },
        });

        SETTINGS['ollama.numCtx'] = 0;
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
        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        const ctrl = new AbortController();
        await generateViaOpenAICompatibleProvider('openai', 'hi', progress, 1, {
            signal: ctrl.signal,
        });

        const [, , opts] = mockedPostJson.mock.calls[0];
        expect((opts as { signal?: AbortSignal }).signal).toBe(ctrl.signal);
    });

    it('forwards options.signal into HttpUtils.postJson for Codestral', async () => {
        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        const ctrl = new AbortController();
        await generateViaOpenAICompatibleProvider('codestral', 'hi', progress, 1, {
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

describe('GroqService payload', () => {
    it('targets Groq chat completions URL with Bearer auth', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await generateViaOpenAICompatibleProvider('groq', 'hello', progress, 1);

        const [url, payload, opts] = mockedPostJson.mock.calls[0];
        expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
        expect(payload).toMatchObject({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: 'hello' }],
            max_tokens: 4096,
        });
        const headers = (opts as { headers: Record<string, string> }).headers;
        expect(headers['Authorization']).toBe('Bearer test-key');
    });
});

describe('OpenRouterService payload', () => {
    it('targets OpenRouter URL with attribution headers and Bearer auth', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await generateViaOpenAICompatibleProvider('openrouter', 'hello', progress, 1);

        const [url, payload, opts] = mockedPostJson.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(payload).toMatchObject({
            model: 'meta-llama/llama-3.3-70b-instruct:free',
        });
        const headers = (opts as { headers: Record<string, string> }).headers;
        expect(headers['Authorization']).toBe('Bearer test-key');
        expect(headers['HTTP-Referer']).toBe('https://github.com/VizzleTF/CommitSage');
        expect(headers['X-Title']).toBe('Commit Sage');
    });
});

describe('DeepSeekService payload', () => {
    it('targets DeepSeek chat completions URL', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await generateViaOpenAICompatibleProvider('deepseek', 'hello', progress, 1);

        const [url, payload] = mockedPostJson.mock.calls[0];
        expect(url).toBe('https://api.deepseek.com/chat/completions');
        expect(payload).toMatchObject({ model: 'deepseek-chat' });
    });
});

describe('XaiService payload', () => {
    it('targets xAI chat completions URL', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await generateViaOpenAICompatibleProvider('xai', 'hello', progress, 1);

        const [url, payload] = mockedPostJson.mock.calls[0];
        expect(url).toBe('https://api.x.ai/v1/chat/completions');
        expect(payload).toMatchObject({ model: 'grok-3-mini' });
    });
});

describe('fetchXaiModels fallback', () => {
    it('falls back to static list on HTTP 403 (team without credits)', async () => {
        const { fetchXaiModels } = await import('../src/services/modelLists');
        const { HttpError } = await import('../src/utils/httpUtils');

        mockedGetJson.mockRejectedValueOnce(
            new HttpError(403, { error: "Your newly created team doesn't have any credits or licenses yet." }),
        );

        const models = await fetchXaiModels('test-key');
        expect(models.length).toBeGreaterThan(0);
        expect(models).toContain('grok-3-mini');
    });

    it('returns live list when /v1/models succeeds', async () => {
        const { fetchXaiModels } = await import('../src/services/modelLists');

        mockedGetJson.mockResolvedValueOnce({
            data: [{ id: 'grok-future-1' }, { id: 'grok-future-2' }],
        });

        const models = await fetchXaiModels('test-key');
        expect(models).toEqual(['grok-future-1', 'grok-future-2']);
    });
});

describe('AnthropicService payload', () => {
    it('targets /v1/messages with x-api-key, anthropic-version, no Authorization', async () => {
        const { AnthropicService } = await import('../src/services/anthropicService');

        mockedPostJson.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'feat: ok' }],
        });

        await AnthropicService.generateCommitMessage('hello', progress, 1);

        const [url, payload, opts] = mockedPostJson.mock.calls[0];
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(payload).toMatchObject({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4096,
            messages: [{ role: 'user', content: 'hello' }],
        });
        const headers = (opts as { headers: Record<string, string> }).headers;
        expect(headers['x-api-key']).toBe('test-key');
        expect(headers['anthropic-version']).toBe('2023-06-01');
        expect(headers['Authorization']).toBeUndefined();
    });

    it('extracts text from content[0].text', async () => {
        const { AnthropicService } = await import('../src/services/anthropicService');

        mockedPostJson.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'fix: bug squashed' }],
        });

        const result = await AnthropicService.generateCommitMessage('hi', progress, 1);
        expect(result.message).toBe('fix: bug squashed');
        expect(result.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('throws ApiKeyInvalidError on HTTP 401', async () => {
        const { AnthropicService } = await import('../src/services/anthropicService');
        const { ApiKeyInvalidError } = await import('../src/models/errors');
        const { HttpError } = await import('../src/utils/httpUtils');

        mockedPostJson.mockRejectedValueOnce(new HttpError(401, {}));

        await expect(
            AnthropicService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeInstanceOf(ApiKeyInvalidError);
    });
});

describe('CustomOpenAIService payload', () => {
    it('omits Authorization header when custom.useApiKey is false', async () => {
        SETTINGS['custom.useApiKey'] = false;

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await generateViaOpenAICompatibleProvider('custom', 'hello', progress, 1);

        const [url, payload, opts] = mockedPostJson.mock.calls[0];
        expect(url).toBe('http://localhost:1234/v1/chat/completions');
        expect(payload).toMatchObject({ model: 'qwen2.5-coder' });
        const headers = (opts as { headers: Record<string, string> }).headers;
        expect(headers['Authorization']).toBeUndefined();
    });

    it('sends Bearer auth when custom.useApiKey is true', async () => {
        SETTINGS['custom.useApiKey'] = true;

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' } }],
        });

        await generateViaOpenAICompatibleProvider('custom', 'hello', progress, 1);

        const [, , opts] = mockedPostJson.mock.calls[0];
        const headers = (opts as { headers: Record<string, string> }).headers;
        expect(headers['Authorization']).toBe('Bearer test-key');

        // restore for subsequent tests
        SETTINGS['custom.useApiKey'] = false;
    });

    it('honors custom.chatCompletionsPath override', async () => {
        SETTINGS['custom.chatCompletionsPath'] = '/v1/completions';

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });

        await generateViaOpenAICompatibleProvider('custom', 'hi', progress, 1);

        const [url] = mockedPostJson.mock.calls[0];
        expect(url).toBe('http://localhost:1234/v1/v1/completions');

        SETTINGS['custom.chatCompletionsPath'] = '/chat/completions';
    });
});

// A message that stopped at the token cap is cut off mid-line but otherwise
// looks valid, so every provider has to recognize its own "ran out of budget"
// signal rather than committing the fragment (#447).
describe('truncated responses are rejected, not committed', () => {
    it('OpenAI-compatible: finish_reason "length"', async () => {
        const { TruncatedResponseError } = await import('../src/models/errors');
        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'fix(auth): wrap reset form in' }, finish_reason: 'length' }],
        });

        await expect(
            generateViaOpenAICompatibleProvider('openai', 'hi', progress, 1)
        ).rejects.toBeInstanceOf(TruncatedResponseError);
    });

    it('OpenAI-compatible: finish_reason "stop" is accepted', async () => {
        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'feat: ok' }, finish_reason: 'stop' }],
        });

        const result = await generateViaOpenAICompatibleProvider('openai', 'hi', progress, 1);
        expect(result.message).toBe('feat: ok');
    });

    it('Anthropic: stop_reason "max_tokens"', async () => {
        const { AnthropicService } = await import('../src/services/anthropicService');
        const { TruncatedResponseError } = await import('../src/models/errors');
        mockedPostJson.mockResolvedValueOnce({
            content: [{ type: 'text', text: 'fix(auth): wrap reset form in' }],
            stop_reason: 'max_tokens',
        });

        await expect(
            AnthropicService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeInstanceOf(TruncatedResponseError);
    });

    it('Ollama: done_reason "length"', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        const { TruncatedResponseError } = await import('../src/models/errors');
        mockedPostJson.mockResolvedValueOnce({
            message: { content: 'fix(auth): wrap reset form in' },
            done_reason: 'length',
        });

        await expect(
            OllamaService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeInstanceOf(TruncatedResponseError);
    });

    it('Ollama: done_reason "stop" is accepted', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        mockedPostJson.mockResolvedValueOnce({
            message: { content: 'feat: ok' },
            done_reason: 'stop',
        });

        const result = await OllamaService.generateCommitMessage('hi', progress, 1);
        expect(result.message).toBe('feat: ok');
    });
});
