// Single owner of the VS Code webview API handle. `acquireVsCodeApi()` may be
// called only once per page, so every other module imports `vscode` from here
// instead of acquiring its own.

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

export const vscode = acquireVsCodeApi();

export function send(message: unknown): void {
    vscode.postMessage(message);
}

export function setSetting(key: string, value: string | boolean | number): void {
    send({ type: 'setSetting', key, value });
}
