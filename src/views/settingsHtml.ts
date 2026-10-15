import { InitData } from './webview/protocol';

/**
 * Pure HTML rendering for the settings webview. Split out of
 * `SettingsWebviewProvider` so the provider keeps only lifecycle + message
 * routing + state assembly, while the document template and its escaping live
 * here as side-effect-free string functions.
 */

function escapeHtml(s: string): string {
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

// `<` only occurs inside JSON strings, where `\u003c` is the same character.
// That keeps `</script>` and `<!--` out of the <script> block and the JSON valid.
function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replaceAll('<', String.raw`\u003c`);
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
    <script id="init-data" type="application/json">${jsonForScript(initData)}</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
