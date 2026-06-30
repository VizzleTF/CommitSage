import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { Provider } from '../src/views/webview/protocol';

// Loaded lazily in beforeAll: a static import would force module resolution
// during vi.mock hoisting, before the mocked-fn consts below are initialized.
let generateViaOpenAICompatibleProvider:
    typeof import('../src/services/openAICompatibleService')['generateViaOpenAICompatibleProvider'];

// ---------------------------------------------------------------------------
// Shared mocks (mirror tests/providerPayloads.test.ts pattern).
// ---------------------------------------------------------------------------

const mockedPostJson = vi.fn();
const mockedGetJson = vi.fn();

vi.mock('../src/utils/httpUtils', async () => {
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

const mockedGetKey = vi.fn(async () => 'test-key');
const mockedGetOptionalKey = vi.fn(async () => undefined as string | undefined);

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: {
        getKey: (...args: unknown[]) => mockedGetKey(...(args as [])),
        getOptionalKey: (...args: unknown[]) => mockedGetOptionalKey(...(args as [])),
    },
}));

const SETTINGS: Record<string, string | number | boolean | undefined> = {
    'openai.model': 'gpt-test',
    'openai.baseUrl': 'https://api.openai.com/v1',
    'codestral.model': 'codestral-latest',
    'ollama.model': 'llama3.2',
    'ollama.baseUrl': 'http://localhost:11434',
    'gemini.model': 'gemini-2.5-flash',
    'openrouter.model': 'meta-llama/llama-3.3-70b-instruct:free',
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
};

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => SETTINGS[key],
        getModelFor: (provider: string) => SETTINGS[`${provider}.model`],
    },
}));

// RetryUtils mock whose handleGenerationError is overridable per-test.
const handleGenerationErrorImpl = {
    fn: async (err: Error): Promise<never> => {
        throw err;
    },
};

vi.mock('../src/utils/retryUtils', () => ({
    RetryUtils: {
        updateProgressForAttempt: vi.fn(async () => undefined),
        handleGenerationError: vi.fn(
            (
                err: Error,
                prompt: string,
                progress: unknown,
                attempt: number,
                generateFn: (p: string, pr: unknown, a: number) => Promise<unknown>,
                errorHandler: (e: Error) => unknown
            ) => handleGenerationErrorImpl.fn(err, prompt, progress, attempt, generateFn, errorHandler)
        ),
    },
}));

const progress = { report: () => undefined };

beforeAll(async () => {
    ({ generateViaOpenAICompatibleProvider } = await import('../src/services/openAICompatibleService'));
});

beforeEach(() => {
    mockedPostJson.mockReset();
    mockedGetJson.mockReset();
    mockedGetKey.mockReset();
    mockedGetKey.mockResolvedValue('test-key');
    mockedGetOptionalKey.mockReset();
    mockedGetOptionalKey.mockResolvedValue(undefined);
    // default: rethrow
    handleGenerationErrorImpl.fn = async (err: Error): Promise<never> => {
        throw err;
    };
    SETTINGS['custom.useApiKey'] = false;
    SETTINGS['custom.chatCompletionsPath'] = '/chat/completions';
    SETTINGS['ollama.numCtx'] = 0;
    SETTINGS['general.temperature'] = 0.7;
});

/**
 * Make handleGenerationError invoke the retry closure (generateFn) once.
 * This exercises the `(p, pr, a) => this.generateCommitMessage(...)` arrow
 * passed by every provider (the "line 24/31/32/44" uncovered closures).
 */
function retryOnce(): void {
    handleGenerationErrorImpl.fn = (async (
        _err: Error,
        prompt: string,
        pr: unknown,
        attempt: number,
        generateFn: (p: string, pr: unknown, a: number) => Promise<unknown>
    ) => {
        return generateFn(prompt, pr, attempt + 1);
    }) as typeof handleGenerationErrorImpl.fn;
}

// ---------------------------------------------------------------------------
// baseAIService: getConfiguredTemperature + isInvalidApiKeyError + retry path.
// ---------------------------------------------------------------------------

describe('getConfiguredTemperature', () => {
    it('returns 0.7 when value is not a number', async () => {
        const { getConfiguredTemperature } = await import('../src/services/baseAIService');
        SETTINGS['general.temperature'] = 'nope' as unknown as number;
        expect(getConfiguredTemperature()).toBe(0.7);
        SETTINGS['general.temperature'] = 0.7;
    });

    it('returns 0.7 when value is NaN (non-finite)', async () => {
        const { getConfiguredTemperature } = await import('../src/services/baseAIService');
        SETTINGS['general.temperature'] = Number.NaN;
        expect(getConfiguredTemperature()).toBe(0.7);
        SETTINGS['general.temperature'] = 0.7;
    });

    it('clamps to [0, 2]', async () => {
        const { getConfiguredTemperature } = await import('../src/services/baseAIService');
        SETTINGS['general.temperature'] = 5;
        expect(getConfiguredTemperature()).toBe(2);
        SETTINGS['general.temperature'] = -3;
        expect(getConfiguredTemperature()).toBe(0);
        SETTINGS['general.temperature'] = 1.2;
        expect(getConfiguredTemperature()).toBe(1.2);
        SETTINGS['general.temperature'] = 0.7;
    });
});

describe('isInvalidApiKeyError', () => {
    it('true for 401', async () => {
        const { isInvalidApiKeyError } = await import('../src/services/baseAIService');
        const { HttpError } = await import('../src/utils/httpUtils');
        expect(isInvalidApiKeyError(new HttpError(401, {}))).toBe(true);
    });

    it('400 with string body matching "incorrect api key"', async () => {
        const { isInvalidApiKeyError } = await import('../src/services/baseAIService');
        const { HttpError } = await import('../src/utils/httpUtils');
        expect(
            isInvalidApiKeyError(new HttpError(400, 'Incorrect API key provided: sk-xxx'))
        ).toBe(true);
    });

    it('400 with { error: string } body', async () => {
        const { isInvalidApiKeyError } = await import('../src/services/baseAIService');
        const { HttpError } = await import('../src/utils/httpUtils');
        expect(
            isInvalidApiKeyError(new HttpError(400, { error: 'invalid api key' }))
        ).toBe(true);
    });

    it('400 with { error: { message } } body', async () => {
        const { isInvalidApiKeyError } = await import('../src/services/baseAIService');
        const { HttpError } = await import('../src/utils/httpUtils');
        expect(
            isInvalidApiKeyError(new HttpError(400, { error: { message: 'api key expired' } }))
        ).toBe(true);
    });

    it('400 with object body but no error field falls to JSON.stringify (no match)', async () => {
        const { isInvalidApiKeyError } = await import('../src/services/baseAIService');
        const { HttpError } = await import('../src/utils/httpUtils');
        expect(isInvalidApiKeyError(new HttpError(400, { foo: 'bar' }))).toBe(false);
    });

    it('400 with error object but no message → JSON.stringify fallback', async () => {
        const { isInvalidApiKeyError } = await import('../src/services/baseAIService');
        const { HttpError } = await import('../src/utils/httpUtils');
        // error is an object without `message`; messageText becomes JSON.stringify(data)
        expect(isInvalidApiKeyError(new HttpError(400, { error: {} }))).toBe(false);
    });

    it('false for other status codes', async () => {
        const { isInvalidApiKeyError } = await import('../src/services/baseAIService');
        const { HttpError } = await import('../src/utils/httpUtils');
        expect(isInvalidApiKeyError(new HttpError(500, {}))).toBe(false);
    });

    it('400 where messageText resolves null → nullish-coalesce to "" (branch 81)', async () => {
        const { isInvalidApiKeyError } = await import('../src/services/baseAIService');
        const { HttpError } = await import('../src/utils/httpUtils');
        // data is undefined: typeof message !== 'string', message?.message undefined,
        // JSON.stringify(undefined) === undefined → messageText is undefined → `?? ''`.
        expect(isInvalidApiKeyError(new HttpError(400, undefined))).toBe(false);
    });
});

describe('handleHttpError "Unknown error" fallback (branch 180)', () => {
    it('uses "Unknown error" when a plain Error has an empty message', async () => {
        const { handleHttpError } = await import('../src/services/baseAIService');
        const err = new Error('');
        const r = handleHttpError(err, 'X');
        expect(r.errorMessage).toBe('Unknown error');
        expect(r.shouldRetry).toBe(false);
    });
});

describe('withRetryAndApiKeyGuard error delegation', () => {
    it('delegates non-401 HttpError to RetryUtils.handleGenerationError (lines 49-55)', async () => {
        const { withRetryAndApiKeyGuard } = await import('../src/services/baseAIService');
        const { RetryUtils } = await import('../src/utils/retryUtils');
        const { HttpError } = await import('../src/utils/httpUtils');

        const retryFn = vi.fn(async () => ({ message: 'm', model: 'x' }));
        const err = new HttpError(500, {});

        await expect(
            withRetryAndApiKeyGuard('Foo', 'p', progress, 1, retryFn, async () => {
                throw err;
            })
        ).rejects.toBe(err);

        expect(RetryUtils.handleGenerationError).toHaveBeenCalledTimes(1);
        // verify the errorHandler maps via handleHttpError with "<name> API"
        const call = (RetryUtils.handleGenerationError as ReturnType<typeof vi.fn>).mock.calls[0];
        const errorHandler = call[5] as (e: Error) => { errorMessage: string };
        const mapped = errorHandler(new HttpError(429, {}));
        expect(mapped.errorMessage).toBeDefined();
    });

    it('throws ApiKeyInvalidError on 401 without delegating', async () => {
        const { withRetryAndApiKeyGuard } = await import('../src/services/baseAIService');
        const { ApiKeyInvalidError } = await import('../src/models/errors');
        const { HttpError } = await import('../src/utils/httpUtils');

        await expect(
            withRetryAndApiKeyGuard('Foo', 'p', progress, 1, vi.fn(), async () => {
                throw new HttpError(401, {});
            })
        ).rejects.toBeInstanceOf(ApiKeyInvalidError);
    });
});

// ---------------------------------------------------------------------------
// openAICompatibleService: retry closure + max_tokens default branch.
// Covers OpenAI/Groq/OpenRouter/DeepSeek/xAI line-24 closures + lib lines.
// ---------------------------------------------------------------------------

interface RetryCase {
    name: string;
    provider: Provider;
    model: string;
}

// All OpenAI-compatible providers now share one dispatcher; the retry closure
// lives once in `generateViaOpenAICompatibleProvider`. Exercise it per provider
// id to cover key acquisition + the recursive retry arrow for each.
const retryCases: RetryCase[] = [
    { name: 'openai', provider: 'openai', model: 'gpt-test' },
    { name: 'groq', provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { name: 'openrouter', provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    { name: 'deepseek', provider: 'deepseek', model: 'deepseek-chat' },
    { name: 'xai', provider: 'xai', model: 'grok-3-mini' },
    { name: 'custom', provider: 'custom', model: 'qwen2.5-coder' },
];

describe.each(retryCases)('$name retry closure', ({ provider, model }) => {
    it('invokes the retry closure after a transient error then succeeds', async () => {
        retryOnce();

        // first call throws (transient 500), second call (the retry closure) succeeds
        mockedPostJson
            .mockRejectedValueOnce(
                new (await import('../src/utils/httpUtils')).HttpError(500, {})
            )
            .mockResolvedValueOnce({ choices: [{ message: { content: 'feat: ok' } }] });

        const result = await generateViaOpenAICompatibleProvider(provider, 'hello', progress, 1);
        expect(result).toEqual({ message: 'feat: ok', model });
        expect(mockedPostJson).toHaveBeenCalledTimes(2);
    });

    it('throws ApiKeyInvalidError on 401', async () => {
        const { ApiKeyInvalidError } = await import('../src/models/errors');
        mockedPostJson.mockRejectedValueOnce(
            new (await import('../src/utils/httpUtils')).HttpError(401, {})
        );
        await expect(
            generateViaOpenAICompatibleProvider(provider, 'hi', progress, 1)
        ).rejects.toBeInstanceOf(ApiKeyInvalidError);
    });
});

describe('generateViaOpenAICompatible defaults', () => {
    it('defaults max_tokens to 1024 and forwards provided maxTokens', async () => {

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });
        await generateViaOpenAICompatibleProvider('openai', 'hi', progress, 1);
        expect(mockedPostJson.mock.calls[0][1]).toMatchObject({ max_tokens: 1024 });

        mockedPostJson.mockResolvedValueOnce({
            choices: [{ message: { content: 'ok' } }],
        });
        await generateViaOpenAICompatibleProvider('openai', 'hi', progress, 1, { maxTokens: 50 });
        expect(mockedPostJson.mock.calls[1][1]).toMatchObject({ max_tokens: 50 });
    });
});

// ---------------------------------------------------------------------------
// CustomOpenAIService: useApiKey true branch (apiKey fetched).
// ---------------------------------------------------------------------------

describe('CustomOpenAIService key handling', () => {
    it('fetches the api key when custom.useApiKey is true', async () => {
        SETTINGS['custom.useApiKey'] = true;
        mockedPostJson.mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });

        await generateViaOpenAICompatibleProvider('custom', 'hi', progress, 1);
        expect(mockedGetKey).toHaveBeenCalledWith('custom');
        const [, , opts] = mockedPostJson.mock.calls[0];
        const headers = (opts as { headers: Record<string, string> }).headers;
        expect(headers['Authorization']).toBe('Bearer test-key');
        SETTINGS['custom.useApiKey'] = false;
    });

    it('does not fetch the api key when custom.useApiKey is false', async () => {
        SETTINGS['custom.useApiKey'] = false;
        mockedPostJson.mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });

        await generateViaOpenAICompatibleProvider('custom', 'hi', progress, 1);
        expect(mockedGetKey).not.toHaveBeenCalled();
        const [, , opts] = mockedPostJson.mock.calls[0];
        const headers = (opts as { headers: Record<string, string> }).headers;
        expect(headers['Authorization']).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// AnthropicService: retry closure (line 44) + maxTokens default.
// ---------------------------------------------------------------------------

describe('AnthropicService coverage', () => {
    it('invokes the retry closure after a transient error then succeeds', async () => {
        const { AnthropicService } = await import('../src/services/anthropicService');
        const { HttpError } = await import('../src/utils/httpUtils');
        retryOnce();

        mockedPostJson
            .mockRejectedValueOnce(new HttpError(500, {}))
            .mockResolvedValueOnce({ content: [{ type: 'text', text: 'feat: ok' }] });

        const result = await AnthropicService.generateCommitMessage('hello', progress, 1);
        expect(result.message).toBe('feat: ok');
        expect(mockedPostJson).toHaveBeenCalledTimes(2);
    });

    it('forwards maxTokens override', async () => {
        const { AnthropicService } = await import('../src/services/anthropicService');
        mockedPostJson.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });
        await AnthropicService.generateCommitMessage('hi', progress, 1, { maxTokens: 77 });
        expect(mockedPostJson.mock.calls[0][1]).toMatchObject({ max_tokens: 77 });
    });
});

// ---------------------------------------------------------------------------
// CodestralService: retry closure (line 31).
// ---------------------------------------------------------------------------

describe('CodestralService coverage', () => {
    it('invokes the retry closure after a transient error then succeeds', async () => {
        const { HttpError } = await import('../src/utils/httpUtils');
        retryOnce();

        mockedPostJson
            .mockRejectedValueOnce(new HttpError(500, {}))
            .mockResolvedValueOnce({ choices: [{ message: { content: 'feat: ok' } }] });

        const result = await generateViaOpenAICompatibleProvider('codestral', 'hello', progress, 1);
        expect(result.message).toBe('feat: ok');
        expect(mockedPostJson).toHaveBeenCalledTimes(2);
    });
});

// ---------------------------------------------------------------------------
// GeminiService: lines 43, 78, 180, 191.
// ---------------------------------------------------------------------------

describe('GeminiService coverage', () => {
    it('retry closure (line 191) for single-model branch', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        const { HttpError } = await import('../src/utils/httpUtils');
        SETTINGS['gemini.model'] = 'gemini-2.5-flash';
        retryOnce();

        mockedPostJson
            .mockRejectedValueOnce(new HttpError(500, {}))
            .mockResolvedValueOnce({
                candidates: [{ content: { parts: [{ text: 'feat: ok' }] } }],
            });

        const result = await GeminiService.generateCommitMessage('hello', progress, 1);
        expect(result).toEqual({ message: 'feat: ok', model: 'gemini-2.5-flash' });
        expect(mockedPostJson).toHaveBeenCalledTimes(2);
    });

    it('buildGeminiGenerationConfig uses options.maxTokens (line 43)', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        SETTINGS['gemini.model'] = 'gemini-2.5-flash';
        mockedPostJson.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        });

        await GeminiService.generateCommitMessage('hi', progress, 1, { maxTokens: 256 });
        const payload = mockedPostJson.mock.calls[0][1] as {
            generationConfig: { maxOutputTokens: number };
        };
        expect(payload.generationConfig.maxOutputTokens).toBe(256);
    });

    it('auto mode throws when no models available (line 180)', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        SETTINGS['gemini.model'] = 'auto';
        // getAvailableModels returns [] only if getJson returns empty models AND
        // sort yields empty. Force the fetch to return an empty models array.
        mockedGetJson.mockResolvedValueOnce({ models: [] });

        await expect(
            GeminiService.generateCommitMessage('hi', progress, 1)
        ).rejects.toThrow('No available Gemini models found');

        SETTINGS['gemini.model'] = 'gemini-2.5-flash';
    });

    it('sort tie-break via localeCompare (line 78) — same tier & version', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        SETTINGS['gemini.model'] = 'auto';
        // two flash models, same version 2.5 → tierDiff 0, versionDiff 0 → localeCompare
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-flash-b', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-flash-a', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        mockedPostJson.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ text: 'feat: ok' }] } }],
        });

        const result = await GeminiService.generateCommitMessage('hi', progress, 1);
        // localeCompare orders -a before -b, so first model tried is ...-a
        expect(result.model).toBe('gemini-2.5-flash-a');
        SETTINGS['gemini.model'] = 'gemini-2.5-flash';
    });

    it('getAvailableModels falls back to static list on fetch error', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedGetJson.mockRejectedValueOnce(new Error('network down'));
        const models = await GeminiService.getAvailableModels('k');
        expect(models.length).toBeGreaterThan(0);
        expect(models).toContain('gemini-2.5-pro');
    });

    it('auto mode: all-401 throws ApiKeyInvalidError', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        const { ApiKeyInvalidError } = await import('../src/models/errors');
        const { HttpError } = await import('../src/utils/httpUtils');
        SETTINGS['gemini.model'] = 'auto';
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        mockedPostJson.mockRejectedValueOnce(new HttpError(401, {}));

        await expect(
            GeminiService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeInstanceOf(ApiKeyInvalidError);
        SETTINGS['gemini.model'] = 'gemini-2.5-flash';
    });

    it('auto mode: non-401 failures throw aggregate error', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        const { HttpError } = await import('../src/utils/httpUtils');
        SETTINGS['gemini.model'] = 'auto';
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        mockedPostJson.mockRejectedValueOnce(new HttpError(500, { error: 'boom' }));

        await expect(
            GeminiService.generateCommitMessage('hi', progress, 1)
        ).rejects.toThrow('All models failed');
        SETTINGS['gemini.model'] = 'gemini-2.5-flash';
    });

    it('auto mode: non-Error rejection stringified in aggregate', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        SETTINGS['gemini.model'] = 'auto';
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        mockedPostJson.mockRejectedValueOnce('weird-string-failure');

        await expect(
            GeminiService.generateCommitMessage('hi', progress, 1)
        ).rejects.toThrow('All models failed');
        SETTINGS['gemini.model'] = 'gemini-2.5-flash';
    });

    it('geminiVersionScore returns 0 for names without a version (branch 65)', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        // "custom-model" has no gemini-<num> prefix → versionScore 0 for that one.
        // Pair it with a real flash model so the sort comparator hits the
        // versionDiff path where one side scored 0.
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/custom-model', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        const models = await GeminiService.getAvailableModels('k');
        // custom-model (tier 1, version 0) sorts after gemini-2.5-flash (tier 1, version 2.5)
        expect(models).toEqual(['gemini-2.5-flash', 'custom-model']);
    });

    it('getAvailableModels filters out models without generateContent', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] },
            ],
        });
        const models = await GeminiService.getAvailableModels('k');
        expect(models).toEqual(['gemini-2.5-pro']);
    });

    it('sort orders pro > flash > flash-lite and newer versions first', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        const models = await GeminiService.getAvailableModels('k');
        expect(models[0]).toBe('gemini-2.5-pro');
        expect(models[models.length - 1]).toBe('gemini-2.5-flash-lite');
        // gemini-3-flash (version 3) before gemini-2.5-flash (version 2.5)
        expect(models.indexOf('gemini-3-flash')).toBeLessThan(models.indexOf('gemini-2.5-flash'));
    });
});

// ---------------------------------------------------------------------------
// OllamaService: line 56 (auth header) + 75-96 (error handler branches).
// ---------------------------------------------------------------------------

describe('OllamaService coverage', () => {
    it('adds Authorization header when an optional key is present (line 56)', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        mockedGetOptionalKey.mockResolvedValueOnce('ollama-token');
        mockedPostJson.mockResolvedValueOnce({ message: { content: 'feat: ok' } });

        await OllamaService.generateCommitMessage('hi', progress, 1);
        const [, , opts] = mockedPostJson.mock.calls[0];
        const headers = (opts as { headers: Record<string, string> }).headers;
        expect(headers['Authorization']).toBe('Bearer ollama-token');
    });

    it('maps 404 to "Model not found" (no retry)', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        const { HttpError } = await import('../src/utils/httpUtils');
        // capture errorHandler result via real handleGenerationError-like behavior:
        // here our mocked handleGenerationError rethrows, so assert the mapper output.
        const { RetryUtils } = await import('../src/utils/retryUtils');

        mockedPostJson.mockRejectedValueOnce(new HttpError(404, {}));
        await expect(
            OllamaService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeTruthy();

        const call = (RetryUtils.handleGenerationError as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
        const errorHandler = call[5] as (e: Error) => { errorMessage: string; statusCode?: number; shouldRetry: boolean };
        const mapped = errorHandler(new HttpError(404, {}));
        expect(mapped.errorMessage).toContain('Model not found');
        expect(mapped.shouldRetry).toBe(false);
        expect(mapped.statusCode).toBe(404);
    });

    it('maps 500 to Ollama server-error text', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        const { HttpError } = await import('../src/utils/httpUtils');
        const { RetryUtils } = await import('../src/utils/retryUtils');

        mockedPostJson.mockRejectedValueOnce(new HttpError(500, {}));
        await expect(
            OllamaService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeTruthy();

        const call = (RetryUtils.handleGenerationError as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
        const errorHandler = call[5] as (e: Error) => { errorMessage: string; shouldRetry: boolean; statusCode?: number };
        const mapped = errorHandler(new HttpError(500, {}));
        expect(mapped.errorMessage).toContain('Ollama is running properly');
        expect(mapped.shouldRetry).toBe(true);
    });

    it('maps NetworkError to connection text', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        const { HttpError, NetworkError } = await import('../src/utils/httpUtils');
        const { RetryUtils } = await import('../src/utils/retryUtils');

        mockedPostJson.mockRejectedValueOnce(new HttpError(500, {}));
        await expect(
            OllamaService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeTruthy();

        const call = (RetryUtils.handleGenerationError as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
        const errorHandler = call[5] as (e: Error) => { errorMessage: string };
        const mapped = errorHandler(new NetworkError('ECONNREFUSED', { code: 'ECONNREFUSED' }));
        expect(mapped.errorMessage).toContain('make sure Ollama is running');
    });

    it('maps a generic 4xx via handleHttpError fallthrough', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        const { HttpError } = await import('../src/utils/httpUtils');
        const { RetryUtils } = await import('../src/utils/retryUtils');

        mockedPostJson.mockRejectedValueOnce(new HttpError(403, { error: 'forbidden' }));
        await expect(
            OllamaService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeTruthy();

        const call = (RetryUtils.handleGenerationError as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
        const errorHandler = call[5] as (e: Error) => { errorMessage: string; shouldRetry: boolean };
        const mapped = errorHandler(new HttpError(403, { error: 'forbidden' }));
        expect(mapped.errorMessage).toBe('forbidden');
        expect(mapped.shouldRetry).toBe(false);
    });

    it('throws ApiKeyInvalidError on 401', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        const { ApiKeyInvalidError } = await import('../src/models/errors');
        const { HttpError } = await import('../src/utils/httpUtils');
        mockedPostJson.mockRejectedValueOnce(new HttpError(401, {}));
        await expect(
            OllamaService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeInstanceOf(ApiKeyInvalidError);
    });

    it('retries via generateFn closure (lines 75/80) then succeeds', async () => {
        const { OllamaService } = await import('../src/services/ollamaService');
        const { HttpError } = await import('../src/utils/httpUtils');
        retryOnce();

        mockedPostJson
            .mockRejectedValueOnce(new HttpError(500, {}))
            .mockResolvedValueOnce({ message: { content: 'feat: ok' } });

        const result = await OllamaService.generateCommitMessage('hi', progress, 1);
        expect(result).toEqual({ message: 'feat: ok', model: 'llama3.2' });
        expect(mockedPostJson).toHaveBeenCalledTimes(2);
    });
});
