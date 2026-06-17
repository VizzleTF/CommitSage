import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError } from '../src/utils/httpUtils';

const { mockedPostJson, mockedGetJson } = vi.hoisted(() => ({
    mockedPostJson: vi.fn(),
    mockedGetJson: vi.fn(),
}));

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

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: {
        getKey: vi.fn(async () => 'test-key'),
        getOptionalKey: vi.fn(async () => undefined),
    },
}));

const SETTINGS: Record<string, unknown> = {
    'gemini.model': 'auto',
    'general.temperature': 0.7,
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

describe('GeminiService.getAvailableModels (quality-tier sort)', () => {
    it('sorts pro > flash > flash-lite, newest version first within a tier', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-3-flash-preview', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
            ],
        });

        const result = await GeminiService.getAvailableModels('key');

        // pro tier first, then flash (newest version first: 3 before 2.5),
        // then flash-lite last. embedding-only model filtered out.
        expect(result).toEqual([
            'gemini-2.5-pro',
            'gemini-3-flash-preview',
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
        ]);
    });

    it('returns the sorted static fallback when the listing request fails', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedGetJson.mockRejectedValueOnce(new Error('network down'));

        const result = await GeminiService.getAvailableModels('key');

        expect(result[0]).toBe('gemini-2.5-pro');
        expect(result[result.length - 1]).toBe('gemini-2.5-flash-lite');
        expect(result).toContain('gemini-3-flash-preview');
    });
});

describe('GeminiService auto-mode (tryGenerateWithModels)', () => {
    it('returns the first model that succeeds', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        mockedPostJson.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ text: 'feat: ok' }] } }],
        });

        const result = await GeminiService.generateCommitMessage('hi', progress, 1);
        expect(result.message).toBe('feat: ok');
        expect(result.model).toBe('gemini-2.5-pro');
    });

    it('throws ApiKeyInvalidError when every model returns 401', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        const { ApiKeyInvalidError } = await import('../src/models/errors');
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        mockedPostJson.mockRejectedValue(new HttpError(401, { error: 'unauthorized' }));

        await expect(
            GeminiService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeInstanceOf(ApiKeyInvalidError);
    });

    it('throws an aggregated "All models failed" error on mixed failures', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            ],
        });
        mockedPostJson
            .mockRejectedValueOnce(new HttpError(500, { error: 'boom' }))
            .mockRejectedValueOnce(new Error('timeout'));

        await expect(
            GeminiService.generateCommitMessage('hi', progress, 1)
        ).rejects.toThrow(/All models failed/);
    });
});
