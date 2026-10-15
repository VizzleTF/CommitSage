// Single owner of the VS Code webview API handle. `acquireVsCodeApi()` may be
// called only once per page, so every other module imports `vscode` from here
// instead of acquiring its own.

import type { IncomingMessage, WebviewSettingKey, WebviewSettings } from './protocol';

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

export const vscode = acquireVsCodeApi();

export function send(message: IncomingMessage): void {
    vscode.postMessage(message);
}

export function setSetting<K extends WebviewSettingKey>(key: K, value: WebviewSettings[K]): void {
    send({ type: 'setSetting', key, value });
}
