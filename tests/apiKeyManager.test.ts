import { describe, it, expect, vi, beforeEach } from 'vitest';

const ollamaUseAuthToken = vi.fn(() => false);

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => {
            if (key === 'ollama.useAuthToken') {
                return ollamaUseAuthToken();
            }
            return undefined;
        },
    },
}));

beforeEach(() => {
    ollamaUseAuthToken.mockReset();
    ollamaUseAuthToken.mockReturnValue(false);
});

describe('ApiKeyManager.requiresKeyForCurrentConfig (F038)', () => {
    it('returns true for openai/codestral/gemini', async () => {
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('openai')).toBe(true);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('codestral')).toBe(true);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('gemini')).toBe(true);
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

    it('returns false for unknown providers', async () => {
        const { ApiKeyManager } = await import('../src/services/apiKeyManager');
        expect(ApiKeyManager.requiresKeyForCurrentConfig('claude')).toBe(false);
        expect(ApiKeyManager.requiresKeyForCurrentConfig('')).toBe(false);
    });
});
