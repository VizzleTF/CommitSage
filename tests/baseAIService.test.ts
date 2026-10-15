import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    extractAndValidateMessage,
    handleHttpError,
    isInvalidApiKeyError,
    withRetryAndApiKeyGuard,
} from '../src/services/baseAIService';
import { HttpError, NetworkError } from '../src/utils/httpUtils';
import { errorMessages } from '../src/utils/constants';
import { ApiKeyInvalidError } from '../src/models/errors';

function makeHttpError(status: number, data: unknown = {}): HttpError {
    return new HttpError(status, data);
}

describe('extractAndValidateMessage: cleanup', () => {
    it('trims and returns non-empty message', () => {
        expect(extractAndValidateMessage('  feat: x  ', 'Foo')).toBe('feat: x');
    });

    it('throws on empty', () => {
        expect(() => extractAndValidateMessage('   ', 'Foo')).toThrow();
    });

    it('strips a single think block', () => {
        expect(extractAndValidateMessage('<think>let me see…</think>fix: typo', 'Foo')).toBe('fix: typo');
    });

    it('strips multiple think blocks', () => {
        expect(extractAndValidateMessage('<think>a</think>chore: x<think>b</think>', 'Foo')).toBe('chore: x');
    });

    it('strips a multi-line think block', () => {
        expect(extractAndValidateMessage('<think>\nline1\nline2\n</think>fix: bug', 'Foo')).toBe('fix: bug');
    });

    it('throws when the whole reply is a think block', () => {
        expect(() => extractAndValidateMessage('<think>only thinking</think>', 'Foo')).toThrow('Generated commit message is empty.');
    });
});

describe('extractAndValidateMessage: Signed-off-by', () => {
    it('removes sign-off lines the model wrote', () => {
        expect(extractAndValidateMessage('feat: x\n\nbody\n\nSigned-off-by: Bot <b@x.io>', 'Foo')).toBe('feat: x\n\nbody');
        expect(extractAndValidateMessage('feat: x\r\n\r\n  signed-off-by: a\r\nRefs: #1', 'Foo')).toBe('feat: x\r\n\r\nRefs: #1');
    });

    it('keeps a mention that is not a trailer line', () => {
        expect(extractAndValidateMessage('docs: explain the Signed-off-by: trailer', 'Foo')).toBe('docs: explain the Signed-off-by: trailer');
    });

    it('throws when only a sign-off is left', () => {
        expect(() => extractAndValidateMessage('Signed-off-by: Bot <b@x.io>', 'Foo')).toThrow('Generated commit message is empty.');
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
        const r = handleHttpError(makeHttpError(401), 'X');
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toBe(errorMessages.authenticationError);
        expect(r.statusCode).toBe(401);
    });

    it('402 → payment required, no retry', () => {
        const r = handleHttpError(makeHttpError(402), 'X');
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toBe(errorMessages.paymentRequired);
    });

    it('429 → rate limit, retry', () => {
        const r = handleHttpError(makeHttpError(429), 'X');
        expect(r.shouldRetry).toBe(true);
        expect(r.errorMessage).toBe(errorMessages.rateLimitExceeded);
    });

    it('422 → invalid request, prefers server message when present', () => {
        const r = handleHttpError(
            makeHttpError(422, { error: { message: 'too long' } }),
            'X'
        );
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toBe('too long');
    });

    it('422 falls back to default when no server message', () => {
        const r = handleHttpError(makeHttpError(422), 'X');
        expect(r.errorMessage).toBe(errorMessages.invalidRequest);
    });

    it('500 → server error, retry', () => {
        const r = handleHttpError(makeHttpError(500), 'X');
        expect(r.shouldRetry).toBe(true);
        expect(r.errorMessage).toBe(errorMessages.serverError);
    });

    it('default 5xx is retried, default 4xx is not', () => {
        expect(handleHttpError(makeHttpError(503), 'X').shouldRetry).toBe(true);
        expect(handleHttpError(makeHttpError(404), 'X').shouldRetry).toBe(false);
    });

    it('NetworkError yields connection-error and retry', () => {
        const err = new NetworkError('ECONNREFUSED: connect refused', { code: 'ECONNREFUSED' });
        const r = handleHttpError(err, 'Ollama');
        expect(r.shouldRetry).toBe(true);
        expect(r.errorMessage).toContain('Ollama');
    });

    it('plain Error falls through to message', () => {
        const r = handleHttpError(new Error('oops'), 'X');
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toBe('oops');
    });

    it('403 with credits/licenses message surfaces server text (xAI new team)', () => {
        const text = "Your newly created team doesn't have any credits or licenses yet. Buy at https://x.ai";
        const r = handleHttpError(makeHttpError(403, { error: text }), 'xAI');
        expect(r.shouldRetry).toBe(false);
        expect(r.statusCode).toBe(403);
        expect(r.errorMessage).toBe(text);
    });

    it('403 with credits/licenses message in a bare string body is surfaced', () => {
        const text = 'no credits or licenses yet';
        const r = handleHttpError(makeHttpError(403, text), 'xAI');
        expect(r.errorMessage).toBe(text);
        expect(r.shouldRetry).toBe(false);
    });

    it('403 with a generic server message surfaces that message', () => {
        const r = handleHttpError(
            makeHttpError(403, { error: { message: 'Forbidden: region blocked' } }),
            'X'
        );
        expect(r.shouldRetry).toBe(false);
        expect(r.statusCode).toBe(403);
        expect(r.errorMessage).toBe('Forbidden: region blocked');
    });

    it('403 with no message falls back to the generic authentication error', () => {
        const r = handleHttpError(makeHttpError(403, {}), 'X');
        expect(r.shouldRetry).toBe(false);
        expect(r.statusCode).toBe(403);
        expect(r.errorMessage).toBe(errorMessages.authenticationError);
    });

    it('default branch with object body serializes data into the message', () => {
        const r = handleHttpError(makeHttpError(418, { foo: 'bar' }), 'X');
        expect(r.shouldRetry).toBe(false);
        expect(r.errorMessage).toContain('418');
        expect(r.errorMessage).toContain('{"foo":"bar"}');
    });

    it('default branch with string body uses the string directly', () => {
        const r = handleHttpError(makeHttpError(404, 'not found'), 'X');
        expect(r.errorMessage).toContain('404');
        expect(r.errorMessage).toContain('not found');
    });
});

describe('isInvalidApiKeyError', () => {
    it('recognizes Gemini\'s 400 "API key not valid"', () => {
        const err = makeHttpError(400, { error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
        } });
        expect(isInvalidApiKeyError(err)).toBe(true);
    });

    it('does not treat an unrelated 400 as a key error', () => {
        expect(isInvalidApiKeyError(makeHttpError(400, { error: { message: 'bad prompt' } }))).toBe(false);
    });
});

describe('withRetryAndApiKeyGuard', () => {
    const progress = { report: () => undefined };
    const ok = { message: 'feat: ok', model: 'm' };

    afterEach(() => {
        vi.useRealTimers();
    });

    it('retries a 429 with backoff, passing the attempt number, then succeeds', async () => {
        vi.useFakeTimers();
        const fn = vi.fn()
            .mockRejectedValueOnce(makeHttpError(429))
            .mockRejectedValueOnce(makeHttpError(429))
            .mockResolvedValueOnce(ok);

        const promise = withRetryAndApiKeyGuard('Foo', progress, fn);
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toBe(ok);
        expect(fn.mock.calls.map(c => c[0])).toEqual([1, 2, 3]);
    });

    it('gives up after three retryable failures', async () => {
        vi.useFakeTimers();
        const fn = vi.fn().mockRejectedValue(makeHttpError(500));

        const assertion = expect(withRetryAndApiKeyGuard('Foo', progress, fn))
            .rejects.toThrow(`Failed to generate commit message: ${errorMessages.serverError}`);
        await vi.runAllTimersAsync();
        await assertion;
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry a non-retryable error', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('oops'));
        await expect(withRetryAndApiKeyGuard('Foo', progress, fn))
            .rejects.toThrow('Failed to generate commit message: oops');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws ApiKeyInvalidError on an invalid key without retrying', async () => {
        const fn = vi.fn().mockRejectedValue(makeHttpError(401));
        await expect(withRetryAndApiKeyGuard('Foo', progress, fn)).rejects.toBeInstanceOf(ApiKeyInvalidError);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('maps errors through a custom errorMapper', async () => {
        const fn = vi.fn().mockRejectedValue(makeHttpError(404));
        const mapper = vi.fn(() => ({ errorMessage: 'custom', shouldRetry: false }));
        await expect(withRetryAndApiKeyGuard('Foo', progress, fn, mapper))
            .rejects.toThrow('Failed to generate commit message: custom');
        expect(mapper).toHaveBeenCalledTimes(1);
    });
});
