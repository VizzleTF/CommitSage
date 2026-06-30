import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

const postJson = vi.fn();
const setKey = vi.fn(async () => undefined);
const showInfo = vi.fn(async () => undefined);
const showError = vi.fn(async () => undefined);

vi.mock('../src/utils/httpUtils', () => ({
    HttpUtils: { postJson: (...args: unknown[]) => postJson(...args) },
}));

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: { setKey: (...args: unknown[]) => setKey(...args) },
}));

vi.mock('../src/utils/logger', () => ({
    Logger: {
        log: () => undefined,
        error: () => undefined,
        showInfo: (...args: unknown[]) => showInfo(...args),
        showError: (...args: unknown[]) => showError(...args),
    },
}));

const CONTEXT = { extension: { id: 'VizzleTF.geminicommit' } } as never;
const CALLBACK = 'vscode://VizzleTF.geminicommit/openrouter-auth';

interface UriHandlerLike {
    handleUri(uri: unknown): void;
}

/** Registers the service and returns the captured URI handler. */
async function startLoginAndCaptureHandler(): Promise<{
    handler: UriHandlerLike;
    login: Promise<void>;
}> {
    const { OpenRouterAuthService } = await import('../src/services/openRouterAuthService');
    const reg = vi.spyOn(vscode.window, 'registerUriHandler');
    OpenRouterAuthService.register();
    const handler = reg.mock.calls[0][0] as unknown as UriHandlerLike;

    const login = OpenRouterAuthService.login(CONTEXT);
    // Let awaitCallback set the pending login + fire openExternal before the
    // callback arrives, mirroring the real browser round-trip ordering.
    await Promise.resolve();
    await Promise.resolve();
    return { handler, login };
}

beforeEach(() => {
    vi.restoreAllMocks();
    postJson.mockReset();
    setKey.mockReset();
    setKey.mockResolvedValue(undefined);
    showInfo.mockReset();
    showError.mockReset();
});

describe('OpenRouterAuthService.login', () => {
    it('exchanges the callback code for a key and stores it', async () => {
        postJson.mockResolvedValue({ key: 'sk-or-test' });
        const { handler, login } = await startLoginAndCaptureHandler();

        handler.handleUri(vscode.Uri.parse(`${CALLBACK}?code=abc123`));
        await login;

        // PKCE S256 exchange with the code from the callback.
        expect(postJson).toHaveBeenCalledTimes(1);
        const [url, body] = postJson.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/auth/keys');
        expect(body).toMatchObject({ code: 'abc123', code_challenge_method: 'S256' });
        expect((body as { code_verifier: string }).code_verifier).toBeTruthy();

        expect(setKey).toHaveBeenCalledWith('openrouter', 'sk-or-test');
        expect(showInfo).toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
    });

    it('handles the windowId/code collision (asExternalUri + OpenRouter)', async () => {
        // What VS Code actually delivered in the field: asExternalUri added
        // `?windowId=2`, OpenRouter glued `?code=...`, so windowId landed in
        // the path and the code in the query.
        postJson.mockResolvedValue({ key: 'sk-or-test' });
        const { handler, login } = await startLoginAndCaptureHandler();

        handler.handleUri({ path: '/openrouter-auth?windowId=2', query: 'code=abc123' });
        await login;

        expect(setKey).toHaveBeenCalledWith('openrouter', 'sk-or-test');
    });

    it('reports an error when the callback carries no code', async () => {
        const { handler, login } = await startLoginAndCaptureHandler();

        handler.handleUri(vscode.Uri.parse(CALLBACK));
        await login;

        expect(postJson).not.toHaveBeenCalled();
        expect(setKey).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalled();
    });

    it('reports an error when the token exchange returns no key', async () => {
        postJson.mockResolvedValue({});
        const { handler, login } = await startLoginAndCaptureHandler();

        handler.handleUri(vscode.Uri.parse(`${CALLBACK}?code=abc123`));
        await login;

        expect(setKey).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalled();
    });

    it('ignores callbacks whose path is not the OpenRouter callback', async () => {
        postJson.mockResolvedValue({ key: 'sk-or-test' });
        const { handler, login } = await startLoginAndCaptureHandler();

        // Unrelated path: must not settle the pending login...
        handler.handleUri(vscode.Uri.parse('vscode://VizzleTF.geminicommit/other?code=zzz'));
        expect(setKey).not.toHaveBeenCalled();

        // ...the real callback still completes it.
        handler.handleUri(vscode.Uri.parse(`${CALLBACK}?code=abc123`));
        await login;
        expect(setKey).toHaveBeenCalledWith('openrouter', 'sk-or-test');
    });
});
