import { describe, it, expect } from 'vitest';
import { ApiKeyValidator } from '../src/utils/apiKeyValidator';

describe('ApiKeyValidator.validateStrictFormat (via Gemini/Codestral)', () => {
    const strictValidators: Array<[string, (key: string) => string | null]> = [
        ['Gemini', ApiKeyValidator.validateGeminiApiKey],
        ['Codestral', ApiKeyValidator.validateCodestralApiKey],
    ];

    for (const [name, validate] of strictValidators) {
        describe(name, () => {
            it('rejects an empty key', () => {
                expect(validate('')).toBe('API key cannot be empty');
            });

            it('rejects a key with invalid characters', () => {
                expect(validate('abc$def!')).toBe('API key contains invalid characters');
            });

            it('accepts a key with the allowed charset', () => {
                expect(validate('AIza_test-Key123')).toBeNull();
            });
        });
    }
});

describe('ApiKeyValidator.validateGeminiApiKey (key shapes)', () => {
    it('accepts an old AI Studio key (AIza...)', () => {
        expect(ApiKeyValidator.validateGeminiApiKey('AIzaSyA_test-Key123')).toBeNull();
    });

    it('accepts a new Google key with dots (AQ.Ab8...)', () => {
        expect(ApiKeyValidator.validateGeminiApiKey('AQ.Ab8RN6_test.Key-123')).toBeNull();
    });

    it('still rejects truly invalid characters', () => {
        expect(ApiKeyValidator.validateGeminiApiKey('AQ.Ab8$bad!')).toBe('API key contains invalid characters');
    });
});

describe('ApiKeyValidator.validateNonEmpty (lax providers)', () => {
    it('rejects empty for OpenAI', () => {
        expect(ApiKeyValidator.validateOpenAIApiKey('')).toBe('API key cannot be empty');
    });

    it('accepts any non-empty key for OpenAI (no charset check)', () => {
        expect(ApiKeyValidator.validateOpenAIApiKey('sk-or-v1-$weird/chars')).toBeNull();
    });
});
