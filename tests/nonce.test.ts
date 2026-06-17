import { describe, it, expect } from 'vitest';
import { getNonce } from '../src/utils/nonce';

describe('getNonce', () => {
    it('returns a non-empty alphanumeric string', () => {
        const nonce = getNonce();
        expect(nonce.length).toBeGreaterThan(0);
        expect(nonce).toMatch(/^[a-zA-Z0-9]+$/);
    });

    it('produces unique values across calls', () => {
        const values = new Set(Array.from({ length: 100 }, () => getNonce()));
        expect(values.size).toBe(100);
    });
});
