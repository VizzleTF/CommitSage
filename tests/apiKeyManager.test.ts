import { describe, it, expect, vi, beforeEach } from 'vitest';

const ollamaUseAuthToken = vi.fn(() => false);
const customUseApiKey = vi.fn(() => false);

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => {
            if (key === 'ollama.useAuthToken') {
                return ollamaUseAuthToken();
            }
            if (key === 'custom.useApiKey') {
                return customUseApiKey();
            }
            return undefined;
        },
    },
}));

beforeEach(() => {
    ollamaUseAuthToken.mockReset();
    ollamaUseAuthToken.mockReturnValue(false);
    customUseApiKey.mockReset();
    customUseApiKey.mockReturnValue(false);
});

describe('ApiKeyManager.requiresKeyForCurrentConfig (F038)', () => {
    it('returns true for openai/codestral/gemini', async () => {
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('openai')).toBe(true);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('codestral')).toBe(true);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('gemini')).toBe(true);
    });

    it('returns true for openrouter/groq/anthropic/deepseek/xai', async () => {
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('openrouter')).toBe(true);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('groq')).toBe(true);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('anthropic')).toBe(true);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('deepseek')).toBe(true);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('xai')).toBe(true);
    });

    it('returns false for ollama when useAuthToken is disabled', async () => {
        ollamaUseAuthToken.mockReturnValue(false);
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('ollama')).toBe(false);
    });

    it('returns true for ollama when useAuthToken is enabled', async () => {
        ollamaUseAuthToken.mockReturnValue(true);
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('ollama')).toBe(true);
    });

    it('returns false for custom when useApiKey is disabled', async () => {
        customUseApiKey.mockReturnValue(false);
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('custom')).toBe(false);
    });

    it('returns true for custom when useApiKey is enabled', async () => {
        customUseApiKey.mockReturnValue(true);
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('custom')).toBe(true);
    });

    it('returns false for unknown providers', async () => {
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('claude')).toBe(false);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('')).toBe(false);
    });
});
