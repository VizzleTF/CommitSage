import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';
import { AiServiceError, UserCancelledError } from '../models/errors';
import { HttpUtils } from '../utils/httpUtils';
import { ApiKeyManager } from './apiKeyManager';

const AUTH_URL = 'https://openrouter.ai/auth';
const TOKEN_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
// The path segment of the vscode:// callback URI. Kept distinct so the URI
// handler can ignore callbacks meant for unrelated future flows.
const CALLBACK_PATH = 'openrouter-auth';
// OpenRouter's login page stays open while the user signs in; give them a few
// minutes before abandoning the pending exchange.
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingLogin {
    verifier: string;
    settle: (result: { code: string } | { error: Error }) => void;
}

interface TokenExchangeResponse {
    key?: string;
}

/**
 * OAuth 2.0 Authorization Code + PKCE (S256) login for OpenRouter — the
 * "connect in one click" alternative to pasting an API key. The browser is
 * sent to OpenRouter's `/auth` page; OpenRouter redirects back to our
 * `vscode://` URI with a one-time `code`, which we exchange for a
 * user-controlled API key stored in SecretStorage like any other key.
 *
 * Docs: https://openrouter.ai/docs/guides/overview/auth/oauth
 */
export class OpenRouterAuthService {
    // Only one login can be in flight at a time. The URI handler is global, so
    // it correlates an incoming callback with this pending verifier.
    private static pending: PendingLogin | undefined;

    /** Registers the global URI handler that catches the OAuth redirect. */
    static register(): vscode.Disposable {
        Logger.log('OpenRouter URI handler registered');
        return vscode.window.registerUriHandler({
            handleUri: uri => OpenRouterAuthService.handleCallback(uri),
        });
    }

    static async login(context: vscode.ExtensionContext): Promise<void> {
        // A second login attempt supersedes any in-flight one.
        if (this.pending) {
            this.pending.settle({ error: new UserCancelledError('OpenRouter login restarted') });
            this.pending = undefined;
        }

        const verifier = crypto.randomBytes(32).toString('base64url');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

        // asExternalUri rewrites the authority for Remote/Codespaces/web so the
        // redirect lands back in this exact window rather than a local one.
        const callbackUri = await vscode.env.asExternalUri(
            vscode.Uri.parse(`${vscode.env.uriScheme}://${context.extension.id}/${CALLBACK_PATH}`),
        );

        const authUrl =
            `${AUTH_URL}?callback_url=${encodeURIComponent(callbackUri.toString(true))}` +
            `&code_challenge=${encodeURIComponent(challenge)}` +
            '&code_challenge_method=S256';

        Logger.log(`OpenRouter login: callback=${callbackUri.toString(true)}`);

        try {
            const code = await this.awaitCallback(verifier, authUrl);
            const key = await this.exchangeCodeForKey(code, verifier);
            await ApiKeyManager.setKey('openrouter', key);
            await Logger.showInfo(vscode.l10n.t('Connected to OpenRouter'));
            Logger.log('OpenRouter OAuth login succeeded');
        } catch (error) {
            if (error instanceof UserCancelledError) {
                Logger.log('OpenRouter OAuth login cancelled');
                return;
            }
            Logger.error('OpenRouter OAuth login failed:', toError(error));
            await Logger.showError(
                vscode.l10n.t('OpenRouter login failed: {0}', toError(error).message),
            );
        } finally {
            this.pending = undefined;
        }
    }

    private static awaitCallback(verifier: string, authUrl: string): Thenable<string> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Signing in to OpenRouter…'),
                cancellable: true,
            },
            (_progress, token) =>
                new Promise<string>((resolve, reject) => {
                    let settled = false;
                    const timer = setTimeout(
                        () => settle({ error: new AiServiceError('OpenRouter login timed out') }),
                        LOGIN_TIMEOUT_MS,
                    );

                    const settle = (result: { code: string } | { error: Error }): void => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        clearTimeout(timer);
                        if (this.pending?.settle === settle) {
                            this.pending = undefined;
                        }
                        if ('code' in result) {
                            resolve(result.code);
                        } else {
                            reject(result.error);
                        }
                    };

                    this.pending = { verifier, settle };
                    token.onCancellationRequested(() =>
                        settle({ error: new UserCancelledError('OpenRouter login cancelled') }),
                    );

                    void vscode.env.openExternal(vscode.Uri.parse(authUrl)).then(
                        opened => {
                            if (!opened) {
                                settle({ error: new AiServiceError('Could not open the browser for OpenRouter login') });
                            }
                        },
                        err => settle({ error: toError(err) }),
                    );
                }),
        );
    }

    private static handleCallback(uri: vscode.Uri): void {
        // Strip any query glued into the path: asExternalUri appends a
        // `?windowId=N` for multi-window routing, and OpenRouter then naively
        // concatenates `?code=...` onto our callback, producing a double-query
        // that VS Code folds partly into uri.path.
        const path = uri.path.split('?')[0];
        const code = this.extractCode(uri);
        Logger.log(`URI handler fired: path=${path} hasCode=${!!code} pending=${!!this.pending}`);
        if (!path.endsWith(CALLBACK_PATH)) {
            return;
        }
        const pending = this.pending;
        if (!pending) {
            Logger.log('OpenRouter callback received with no login in progress');
            return;
        }
        if (!code) {
            pending.settle({ error: new AiServiceError('OpenRouter returned no authorization code') });
            return;
        }
        pending.settle({ code });
    }

    /**
     * Pulls the `code` param from the callback, tolerant of the windowId/code
     * collision above: the param can land in uri.query or be left dangling in
     * the path's own query segment.
     */
    private static extractCode(uri: vscode.Uri): string | null {
        const candidates: string[] = [];
        if (uri.query) {
            candidates.push(uri.query);
        }
        const q = uri.path.indexOf('?');
        if (q >= 0) {
            candidates.push(uri.path.slice(q + 1));
        }
        for (const candidate of candidates) {
            const code = new URLSearchParams(candidate).get('code');
            if (code) {
                return code;
            }
        }
        return null;
    }

    private static async exchangeCodeForKey(code: string, verifier: string): Promise<string> {
        const data = await HttpUtils.postJson<TokenExchangeResponse>(
            TOKEN_EXCHANGE_URL,
            {
                code,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                code_verifier: verifier,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                code_challenge_method: 'S256',
            },
            { headers: { 'content-type': 'application/json' } },
        );

        if (!data.key) {
            throw new AiServiceError('OpenRouter token exchange returned no API key');
        }
        return data.key;
    }
}
