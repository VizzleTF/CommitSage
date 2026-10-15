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
        expect(extractAndValidateMessage('feat: x\r\n\r\n  signed-off-by: a\r\nRefs: #1', 'Foo')).toBe('feat: x\n\nRefs: #1');
    });

    it('keeps a mention that is not a trailer line', () => {
        expect(extractAndValidateMessage('docs: explain the Signed-off-by: trailer', 'Foo')).toBe('docs: explain the Signed-off-by: trailer');
    });

    it('throws when only a sign-off is left', () => {
        expect(() => extractAndValidateMessage('Signed-off-by: Bot <b@x.io>', 'Foo')).toThrow('Generated commit message is empty.');
    });
});

describe('extractAndValidateMessage: wrapping', () => {
    const clean = (s: string) => extractAndValidateMessage(s, 'Foo');

    it.each([
        ['a fence with a language tag', '```text\nfeat: x\n\nbody\n```'],
        ['a bare fence', '```\nfeat: x\n\nbody\n```'],
        ['a fence around the sign-off', '```git\nfeat: x\n\nbody\n\nSigned-off-by: Bot <b@x.io>\n```'],
        ['double quotes', '"feat: x\n\nbody"'],
        ['backticks', '`feat: x\n\nbody`'],
        ['curly quotes', '“feat: x\n\nbody”'],
        ['a preamble line', 'Here is the commit message:\n\nfeat: x\n\nbody'],
        ['a "Commit message:" line', 'Commit message:\nfeat: x\n\nbody'],
        ['a preamble, a fence and quotes', "Here's a concise commit message for these changes:\n```\n'feat: x\n\nbody'\n```"],
    ])('strips %s', (_name, reply) => {
        expect(clean(reply)).toBe('feat: x\n\nbody');
    });

    it('unwraps a single-line triple-backtick reply', () => {
        expect(clean('```fix: typo```')).toBe('fix: typo');
    });

    it('keeps backticks that belong to the message', () => {
        expect(clean('fix: handle `null` in `parse`')).toBe('fix: handle `null` in `parse`');
        expect(clean('`npm test` now runs `lint`')).toBe('`npm test` now runs `lint`');
        expect(clean('```\ndocs: show usage\n\n```sh\nnpm i\n```\n```')).toBe('docs: show usage\n\n```sh\nnpm i\n```');
    });

    it('keeps quotes that belong to the message', () => {
        expect(clean('Revert "feat: x"')).toBe('Revert "feat: x"');
        expect(clean('"feat: add "dry-run" flag"')).toBe('"feat: add "dry-run" flag"');
    });

    it('keeps a preamble-like line that is not followed by a message', () => {
        expect(clean('Here is the commit message:')).toBe('Here is the commit message:');
        expect(clean('Here is why:\nfeat: x')).toBe('Here is why:\nfeat: x');
    });

    it('throws when nothing is left after unwrapping', () => {
        expect(() => clean('```\n```')).toThrow('Generated commit message is empty.');
        expect(() => clean('""')).toThrow('Generated commit message is empty.');
    });
});

describe('extractAndValidateMessage: invisible characters', () => {
    const clean = (s: string) => extractAndValidateMessage(s, 'Foo');

    it('removes C0 and C1 controls but keeps newlines and tabs', () => {
        expect(clean('feat: x\u0007\u001b\u0000\r\n\n\tbody\u0085\u009b')).toBe('feat: x\n\n\tbody');
    });

    it('removes bidi controls', () => {
        expect(clean('\u202Efeat: x\u202C \u2066y\u2069 \u202A\u202B\u202D\u2067\u2068z')).toBe('feat: x y z');
    });

    it('removes zero-width characters', () => {
        expect(clean('\uFEFF\u200Bfeat:\u200C x\u2060\u200D')).toBe('feat: x');
    });

    it('keeps the joiner inside an emoji sequence', () => {
        expect(clean('\u{1F9D1}\u200D\u{1F4BB} improve dev experience')).toBe('\u{1F9D1}\u200D\u{1F4BB} improve dev experience');
    });

    it('unwraps a fence hidden behind a zero-width character', () => {
        expect(clean('\u200B```\nfeat: x\n```')).toBe('feat: x');
    });

    it('throws when only invisible characters are left', () => {
        expect(() => clean('\u200B\u202E\u0007')).toThrow('Generated commit message is empty.');
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
