import { describe, it, expect } from 'vitest';
import { ApiKeyValidator } from '../src/utils/apiKeyValidator';
import { PROVIDER_CATALOG } from '../src/services/providerCatalog';

describe('ApiKeyValidator lax validators (validateNonEmpty)', () => {
    it('rejects empty', () => {
        expect(ApiKeyValidator.validateNonEmpty('')).toBe('API key cannot be empty');
    });
    it('accepts any non-empty key', () => {
        expect(ApiKeyValidator.validateNonEmpty('some-$weird/key')).toBeNull();
    });
});

describe('provider catalog wires each provider to a validator', () => {
    // Every lax provider (all but gemini/codestral) should reject an empty key
    // and accept an arbitrary non-empty one, via the catalog-assigned validator.
    const lax = PROVIDER_CATALOG.filter(p => p.id !== 'gemini' && p.id !== 'codestral');
    for (const p of lax) {
        it(`${p.id}: rejects empty`, () => {
            expect(p.validateKey('')).toBe('API key cannot be empty');
        });
        it(`${p.id}: accepts any non-empty key`, () => {
            expect(p.validateKey('some-$weird/key')).toBeNull();
        });
    }

    it('gemini uses the charset-aware validator', () => {
        const gemini = PROVIDER_CATALOG.find(p => p.id === 'gemini')!;
        expect(gemini.validateKey('AQ.Ab8_test.Key-1')).toBeNull();
        expect(gemini.validateKey('bad$char!')).toBe('API key contains invalid characters');
    });

    it('codestral uses the strict validator', () => {
        const codestral = PROVIDER_CATALOG.find(p => p.id === 'codestral')!;
        expect(codestral.validateKey('valid_Key-123')).toBeNull();
        expect(codestral.validateKey('bad$char!')).toBe('API key contains invalid characters');
    });
});
