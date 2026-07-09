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
    'general.maxOutputTokens': 4096,
    'gemini.thinkingBudget': 0,
    'gemini.thinkingLevel': 'low',
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

/** The `generationConfig` of the Nth `postJson` call. */
function generationConfigOf(call: number): Record<string, unknown> {
    const payload = mockedPostJson.mock.calls[call][1] as {
        generationConfig: Record<string, unknown>;
    };
    return payload.generationConfig;
}

beforeEach(() => {
    mockedPostJson.mockReset();
    mockedGetJson.mockReset();
    SETTINGS['gemini.model'] = 'auto';
    SETTINGS['gemini.thinkingBudget'] = 0;
    SETTINGS['gemini.thinkingLevel'] = 'low';
    SETTINGS['general.maxOutputTokens'] = 4096;
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

describe('GeminiService.getAvailableModels (commit-capable filter, #447)', () => {
    it('drops image/audio/embedding variants and non-Gemini families', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        mockedGetJson.mockResolvedValueOnce({
            models: [
                { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemma-4-31b-it', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/learnlm-2.0-flash', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            ],
        });

        const result = await GeminiService.getAvailableModels('key');

        expect(result).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
    });
});

describe('GeminiService thinkingConfig (#447)', () => {
    async function generateWith(model: string): Promise<void> {
        const { GeminiService } = await import('../src/services/geminiService');
        SETTINGS['gemini.model'] = model;
        mockedPostJson.mockResolvedValueOnce({
            candidates: [{ content: { parts: [{ text: 'feat: ok' }] }, finishReason: 'STOP' }],
        });
        await GeminiService.generateCommitMessage('hi', progress, 1);
    }

    it('sends thinkingBudget for Gemini 2.5, defaulting it off', async () => {
        await generateWith('gemini-2.5-flash');
        expect(generationConfigOf(0).thinkingConfig).toEqual({ thinkingBudget: 0 });
    });

    it('raises a 0 budget to 128 for Gemini 2.5 Pro, which cannot disable thinking', async () => {
        await generateWith('gemini-2.5-pro');
        expect(generationConfigOf(0).thinkingConfig).toEqual({ thinkingBudget: 128 });
    });

    it('passes a negative budget through as -1 (model decides), even for Pro', async () => {
        SETTINGS['gemini.thinkingBudget'] = -1;
        await generateWith('gemini-2.5-pro');
        expect(generationConfigOf(0).thinkingConfig).toEqual({ thinkingBudget: -1 });
    });

    it('sends thinkingLevel — not thinkingBudget — for Gemini 3.x', async () => {
        SETTINGS['gemini.thinkingLevel'] = 'medium';
        await generateWith('gemini-3.5-flash');
        expect(generationConfigOf(0).thinkingConfig).toEqual({ thinkingLevel: 'medium' });
    });

    it('omits thinkingConfig for models that reject it (Gemini 2.0, Gemma)', async () => {
        await generateWith('gemini-2.0-flash');
        expect(generationConfigOf(0)).not.toHaveProperty('thinkingConfig');

        mockedPostJson.mockReset();
        await generateWith('gemma-4-31b-it');
        expect(generationConfigOf(0)).not.toHaveProperty('thinkingConfig');
    });

    it('falls back to safe values when a project config supplies junk', async () => {
        SETTINGS['gemini.thinkingBudget'] = 'lots';
        SETTINGS['gemini.thinkingLevel'] = 'extreme';

        await generateWith('gemini-2.5-flash');
        expect(generationConfigOf(0).thinkingConfig).toEqual({ thinkingBudget: 0 });

        mockedPostJson.mockReset();
        await generateWith('gemini-3.5-flash');
        expect(generationConfigOf(0).thinkingConfig).toEqual({ thinkingLevel: 'low' });
    });

    it('sends general.maxOutputTokens as the output budget', async () => {
        SETTINGS['general.maxOutputTokens'] = 2048;
        await generateWith('gemini-2.5-flash');
        expect(generationConfigOf(0).maxOutputTokens).toBe(2048);
    });
});

describe('GeminiService.extractCommitMessage (#447)', () => {
    it('skips the reasoning summary and returns only the answer parts', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        SETTINGS['gemini.model'] = 'gemini-2.5-pro';
        mockedPostJson.mockResolvedValueOnce({
            candidates: [{
                content: {
                    parts: [
                        { text: '"- Validate reset token" -> 45 chars. Good.', thought: true },
                        { text: 'fix(auth): validate reset token' },
                    ],
                },
                finishReason: 'STOP',
            }],
        });

        const result = await GeminiService.generateCommitMessage('hi', progress, 1);
        expect(result.message).toBe('fix(auth): validate reset token');
    });

    it('throws TruncatedResponseError on finishReason MAX_TOKENS instead of a cropped message', async () => {
        const { GeminiService } = await import('../src/services/geminiService');
        const { TruncatedResponseError } = await import('../src/models/errors');
        SETTINGS['gemini.model'] = 'gemini-2.5-pro';
        mockedPostJson.mockResolvedValueOnce({
            candidates: [{
                content: { parts: [{ text: 'fix(auth): wrap reset form in card for' }] },
                finishReason: 'MAX_TOKENS',
            }],
        });

        await expect(
            GeminiService.generateCommitMessage('hi', progress, 1)
        ).rejects.toBeInstanceOf(TruncatedResponseError);
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
