// Webview frontend entry point. Vanilla DOM, no framework. Runs in the
// WebviewView iframe; talks to the extension only via `acquireVsCodeApi()`.
//
// Composition only: parse init (./init), acquire the API (./vscodeApi), and
// assemble the section renderers (./sections) on each state push. All the real
// logic lives in the sibling modules.

import type { ViewState } from './protocol';
import { send } from './vscodeApi';
import {
    renderProviderPick,
    renderModelAuthSection,
    renderCommitSection,
    renderAutomationSection,
    renderCommitlintSection,
    renderAdvancedSection,
} from './sections';

const root = document.getElementById('root') as HTMLElement;

function render(state: ViewState): void {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(renderProviderPick(state));
    fragment.appendChild(renderModelAuthSection(state));
    fragment.appendChild(renderCommitSection(state));
    fragment.appendChild(renderAutomationSection(state));
    fragment.appendChild(renderCommitlintSection(state));
    fragment.appendChild(renderAdvancedSection(state));
    root.innerHTML = '';
    root.appendChild(fragment);
}

window.addEventListener('message', (event: MessageEvent) => {
    // Only accept messages from the VS Code webview host. The webview always
    // runs under a `vscode-webview://` origin; reject anything else so a framed
    // or injected context cannot post state into the view.
    if (!event.origin.startsWith('vscode-webview://')) {
        return;
    }
    const msg = event.data;
    if (msg?.type === 'state') {
        render(msg.state as ViewState);
    }
});

send({ type: 'getState' });
