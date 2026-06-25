import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpUtils, HttpError, NetworkError } from '../src/utils/httpUtils';
import { ConfigService } from '../src/utils/configService';

describe('HttpUtils.createRequestHeaders', () => {
    it('defaults to content-type only when no key', () => {
        expect(HttpUtils.createRequestHeaders()).toEqual({ 'content-type': 'application/json' });
    });

    it('merges additional headers', () => {
        const h = HttpUtils.createRequestHeaders(undefined, { 'x-extra': '1' });
        expect(h['x-extra']).toBe('1');
        expect(h['content-type']).toBe('application/json');
    });

    it('adds a Bearer header by default', () => {
        const h = HttpUtils.createRequestHeaders('abc');
        expect(h['Authorization']).toBe('Bearer abc');
    });

    it('adds an x-api-key header for that auth style', () => {
        const h = HttpUtils.createRequestHeaders('abc', undefined, 'x-api-key');
        expect(h['x-api-key']).toBe('abc');
        expect(h['Authorization']).toBeUndefined();
    });

    it('omits auth header for authStyle none', () => {
        const h = HttpUtils.createRequestHeaders('abc', undefined, 'none');
        expect(h['Authorization']).toBeUndefined();
        expect(h['x-api-key']).toBeUndefined();
    });
});

describe('HttpError / NetworkError', () => {
    it('HttpError carries status, data and default message', () => {
        const e = new HttpError(500, { error: { message: 'boom' } });
        expect(e.name).toBe('HttpError');
        expect(e.status).toBe(500);
        expect(e.message).toBe('HTTP 500');
        expect((e.data as { error: { message: string } }).error.message).toBe('boom');
    });

    it('HttpError uses an explicit message when given', () => {
        const e = new HttpError(404, undefined, 'not found');
        expect(e.message).toBe('not found');
    });

    it('NetworkError carries cause', () => {
        const cause = new Error('orig');
        const e = new NetworkError('failed', cause);
        expect(e.name).toBe('NetworkError');
        expect(e.cause).toBe(cause);
    });
});

describe('HttpUtils.getJson / postJson', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('getJson returns parsed JSON on success', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ hello: 'world' }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await HttpUtils.getJson<{ hello: string }>('https://api.test/', {
            headers: { 'content-type': 'application/json' },
        });
        expect(result).toEqual({ hello: 'world' });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.test/',
            expect.objectContaining({ method: 'GET', body: undefined }),
        );
    });

    it('postJson serializes body and returns parsed JSON', async () => {
        const fetchMock = vi.fn(async (_url: string, init: { body?: string }) => {
            expect(init.body).toBe(JSON.stringify({ a: 1 }));
            return { ok: true, status: 200, json: async () => ({ ok: true }) };
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await HttpUtils.postJson<{ ok: boolean }>('https://api.test', { a: 1 }, {
            headers: {},
        });
        expect(result).toEqual({ ok: true });
        const init = fetchMock.mock.calls[0][1] as { method: string };
        expect(init.method).toBe('POST');
    });

    it('throws HttpError with parsed JSON body on non-2xx JSON response', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: false,
            status: 429,
            text: async () => JSON.stringify({ error: { message: 'rate limited' } }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            HttpUtils.getJson('https://api.test', { headers: {} }),
        ).rejects.toMatchObject({ name: 'HttpError', status: 429 });
    });

    it('throws HttpError with raw text body when body is non-JSON', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: false,
            status: 500,
            text: async () => 'plain error',
        }));
        vi.stubGlobal('fetch', fetchMock);

        try {
            await HttpUtils.getJson('https://api.test', { headers: {} });
            throw new Error('should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(HttpError);
            expect((e as HttpError).data).toBe('plain error');
        }
    });

    it('throws HttpError with undefined data on empty error body', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: false,
            status: 502,
            text: async () => '',
        }));
        vi.stubGlobal('fetch', fetchMock);

        try {
            await HttpUtils.getJson('https://api.test', { headers: {} });
            throw new Error('should have thrown');
        } catch (e) {
            expect((e as HttpError).data).toBeUndefined();
        }
    });

    it('wraps a generic fetch rejection in NetworkError', async () => {
        const fetchMock = vi.fn(async () => {
            throw new TypeError('fetch failed');
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            HttpUtils.getJson('https://api.test', { headers: {} }),
        ).rejects.toBeInstanceOf(NetworkError);
    });

    it('maps ECONNREFUSED cause into the NetworkError message', async () => {
        const fetchMock = vi.fn(async () => {
            const err = new TypeError('fetch failed') as Error & { cause?: unknown };
            err.cause = { code: 'ECONNREFUSED', message: 'connection refused' };
            throw err;
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            HttpUtils.getJson('https://api.test', { headers: {} }),
        ).rejects.toThrow(/ECONNREFUSED: connection refused/);
    });

    it('falls back to error.message when the matched cause has no message', async () => {
        const fetchMock = vi.fn(async () => {
            const err = new TypeError('outer message') as Error & { cause?: unknown };
            // code matches but cause.message is undefined -> exercises the `?? error.message` side
            err.cause = { code: 'ETIMEDOUT' };
            throw err;
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            HttpUtils.getJson('https://api.test', { headers: {} }),
        ).rejects.toThrow('ETIMEDOUT: outer message');
    });

    it('maps a TimeoutError into a friendly message', async () => {
        const fetchMock = vi.fn(async () => {
            const err = new Error('timed out');
            err.name = 'TimeoutError';
            throw err;
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            HttpUtils.getJson('https://api.test', { headers: {} }),
        ).rejects.toThrow('Request timed out.');
    });

    it('uses the error message when cause has no code', async () => {
        const fetchMock = vi.fn(async () => {
            throw new Error('plain network failure');
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            HttpUtils.getJson('https://api.test', { headers: {} }),
        ).rejects.toThrow('plain network failure');
    });

    it('stringifies a non-Error rejection', async () => {
        const fetchMock = vi.fn(async () => {
             
            throw 'string failure';
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            HttpUtils.getJson('https://api.test', { headers: {} }),
        ).rejects.toThrow('string failure');
    });

    it('re-throws an external AbortError without wrapping', async () => {
        const ac = new AbortController();
        ac.abort();
        const fetchMock = vi.fn(async () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            HttpUtils.getJson('https://api.test', { headers: {}, signal: ac.signal }),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('HttpUtils timeout resolution', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('opts.timeoutMs === -1 disables the timeout (signal stays external)', async () => {
        const ac = new AbortController();
        await HttpUtils.getJson('https://api.test', { headers: {}, signal: ac.signal, timeoutMs: -1 });
        const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
        expect(init.signal).toBe(ac.signal);
    });

    it('opts.timeoutMs disables external? combines external + timeout via AbortSignal.any', async () => {
        const ac = new AbortController();
        await HttpUtils.getJson('https://api.test', { headers: {}, signal: ac.signal, timeoutMs: 5000 });
        const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
        // combined signal is a fresh AbortSignal, not the external one
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.signal).not.toBe(ac.signal);
    });

    it('opts.timeoutMs without external signal uses the timeout signal', async () => {
        await HttpUtils.getJson('https://api.test', { headers: {}, timeoutMs: 5000 });
        const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('configured timeout of -1 disables the timeout', async () => {
        vi.spyOn(ConfigService, 'get').mockReturnValue(-1 as never);
        await HttpUtils.getJson('https://api.test', { headers: {} });
        const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
        expect(init.signal).toBeUndefined();
    });

    it('falls back to the configured timeout (seconds -> ms) when none provided', async () => {
        vi.spyOn(ConfigService, 'get').mockReturnValue(30 as never);
        await HttpUtils.getJson('https://api.test', { headers: {} });
        const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });
});
