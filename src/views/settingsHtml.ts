import { InitData } from './webview/protocol';

/**
 * Pure HTML rendering for the settings webview. Split out of
 * `SettingsWebviewProvider` so the provider keeps only lifecycle + message
 * routing + state assembly, while the document template and its escaping live
 * here as side-effect-free string functions.
 */

export function escapeHtml(s: string): string {
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

export function escapeForScript(s: string): string {
    // </script> in JSON would break out of the <script> block. The other two
    // pairs neutralise HTML comment / CDATA endings just in case.
    return s
        .replaceAll(/<\/script>/gi, String.raw`<\/script>`)
        .replaceAll('<!--', String.raw`<\!--`)
        .replaceAll(']]>', String.raw`]]\>`);
}

export interface SettingsHtmlOptions {
    scriptUri: string;
    styleUri: string;
    cspSource: string;
    nonce: string;
    initData: InitData;
    loadingLabel: string;
}

export function renderSettingsHtml(opts: SettingsHtmlOptions): string {
    const { scriptUri, styleUri, cspSource, nonce, initData, loadingLabel } = opts;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
    <link rel="stylesheet" href="${styleUri}">
    <title>Commit Sage</title>
</head>
<body>
    <div id="root"><div class="loading">${escapeHtml(loadingLabel)}</div></div>
    <script id="init-data" type="application/json">${escapeForScript(JSON.stringify(initData))}</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
