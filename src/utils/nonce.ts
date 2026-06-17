import * as crypto from 'node:crypto';

/**
 * Generates a cryptographically strong nonce for the webview CSP
 * `script-src 'nonce-...'` directive. Uses `crypto.randomBytes` rather than
 * `Math.random` so the value is not predictable.
 */
export function getNonce(): string {
    return crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
}
