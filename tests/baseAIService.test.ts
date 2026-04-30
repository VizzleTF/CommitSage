import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import {
    extractAndValidateMessage,
    handleHttpError,
    validateCommitMessage,
} from '../src/services/baseAIService';
import { errorMessages } from '../src/utils/constants';

function makeAxiosError(
    status: number,
    data: unknown = {},
    code?: string
): AxiosError {
    const err = new AxiosError(
        'Request failed',
        code,
        undefined,
        undefined,
        {
            status,
            statusText: '',
            data,
            headers: {},
            config: { headers: new AxiosHeaders() },
        } as never
    );
    return err;
}

describe('validateCommitMessage', () => {
    it('trims and returns non-empty message', () => {
        expect(validateCommitMessage('  feat: x  ')).toBe('feat: x');
    });

    it('throws on empty', () => {
        expect(() => validateCommitMessage('   ')).toThrow();
    });
});

describe('extractAndValidateMessage', () => {
    it('throws when content is undefined', () => {
        expect(() => extractAndValidateMessage(undefined, 'Foo')).toThrow(
            'Invalid response format from Foo API'
        );
    });

    it('throws when content is null', () => {
        expect(() => extractAndValidateMessage(null, 'Foo')).toThrow();
    });

    it('returns trimmed content otherwise', () => {
        expect(extractAndValidateMessage('  ok  ', 'Foo')).toBe('ok');
    });
});

describe('handleHttpError', () => {
    it('401 → authentication error, no retry', () => {
        const r = handleHttpError(makeAxiosError(401), 'X');
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toBe(errorMessages.authenticationError);
        expect(r.statusCode).toBe(401);
    });

    it('402 → payment required, no retry', () => {
        const r = handleHttpError(makeAxiosError(402), 'X');
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toBe(errorMessages.paymentRequired);
    });

    it('429 → rate limit, retry', () => {
        const r = handleHttpError(makeAxiosError(429), 'X');
        expect(r.shouldRetry).toBe(true);
        expect(r.errorMessage).toBe(errorMessages.rateLimitExceeded);
    });

    it('422 → invalid request, prefers server message when present', () => {
        const r = handleHttpError(
            makeAxiosError(422, { error: { message: 'too long' } }),
            'X'
        );
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toBe('too long');
    });

    it('422 falls back to default when no server message', () => {
        const r = handleHttpError(makeAxiosError(422), 'X');
        expect(r.errorMessage).toBe(errorMessages.invalidRequest);
    });

    it('500 → server error, retry', () => {
        const r = handleHttpError(makeAxiosError(500), 'X');
        expect(r.shouldRetry).toBe(true);
        expect(r.errorMessage).toBe(errorMessages.serverError);
    });

    it('default 5xx is retried, default 4xx is not', () => {
        expect(handleHttpError(makeAxiosError(503), 'X').shouldRetry).toBe(true);
        expect(handleHttpError(makeAxiosError(404), 'X').shouldRetry).toBe(false);
    });

    it('ECONNREFUSED yields connection-error and retry', () => {
        // No response on the error — simulates pure network failure
        const err = new AxiosError(
            'connect ECONNREFUSED 127.0.0.1:11434',
            'ECONNREFUSED'
        );
        const r = handleHttpError(err, 'Ollama');
        expect(r.shouldRetry).toBe(true);
        expect(r.errorMessage).toContain('Ollama');
    });

    it('plain Error falls through to message', () => {
        const r = handleHttpError(new Error('oops'), 'X');
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toBe('oops');
    });
});
