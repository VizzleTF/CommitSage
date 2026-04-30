import { describe, it, expect } from 'vitest';
import { sanitizeErrorForTelemetry, toError } from '../src/utils/errorUtils';

describe('toError', () => {
    it('passes Error instances through', () => {
        const e = new Error('boom');
        expect(toError(e)).toBe(e);
    });

    it('wraps non-Error values', () => {
        const e = toError('boom');
        expect(e).toBeInstanceOf(Error);
        expect(e.message).toBe('boom');
    });
});

describe('sanitizeErrorForTelemetry', () => {
    it('redacts file paths', () => {
        const e = new Error('failed at /Users/jane/proj/src/foo.ts:23');
        expect(sanitizeErrorForTelemetry(e).error).toContain('<path>');
        expect(sanitizeErrorForTelemetry(e).error).not.toContain('/Users/jane');
    });

    it('redacts ?key= URL secrets', () => {
        const e = new Error(
            'GET https://generativelanguage.googleapis.com/v1/models?key=AIzaSyABCDEFG failed'
        );
        const out = sanitizeErrorForTelemetry(e).error;
        expect(out).toContain('key=<redacted>');
        expect(out).not.toContain('AIzaSyABCDEFG');
    });

    it('redacts &key= URL secrets', () => {
        const e = new Error('foo?bar=1&key=AIzaSyABCDEFG&baz=2');
        const out = sanitizeErrorForTelemetry(e).error;
        expect(out).toContain('key=<redacted>');
        expect(out).not.toContain('AIzaSyABCDEFG');
    });

    it('redacts Bearer tokens (header form)', () => {
        const e = new Error('Authorization: Bearer sk-abc123XYZ failed');
        const out = sanitizeErrorForTelemetry(e).error;
        // Either Authorization or Bearer redaction may match first; key
        // requirement is that the secret itself never appears.
        expect(out).not.toContain('sk-abc123XYZ');
        expect(out).toContain('<redacted>');
    });

    it('redacts standalone Bearer token', () => {
        const e = new Error('got Bearer abc.def-ghi back');
        const out = sanitizeErrorForTelemetry(e).error;
        expect(out).toContain('Bearer <redacted>');
        expect(out).not.toContain('abc.def-ghi');
    });

    it('redacts x-goog-api-key header strings', () => {
        const e = new Error('x-goog-api-key: AIzaSyABCDEFG');
        const out = sanitizeErrorForTelemetry(e).error;
        expect(out).toContain('x-goog-api-key: <redacted>');
        expect(out).not.toContain('AIzaSyABCDEFG');
    });

    it('preserves errorType from constructor name', () => {
        class MyError extends Error {}
        expect(sanitizeErrorForTelemetry(new MyError('x')).errorType).toBe(
            'MyError'
        );
    });
});
