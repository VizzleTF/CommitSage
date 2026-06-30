// Webview frontend entry point. Vanilla DOM, no framework. Runs in the
// WebviewView iframe; talks to the extension only via `acquireVsCodeApi()`.
//
// Composition only: parse init (./init), acquire the API (./vscodeApi), and
// assemble the section renderers (./sections) on each state push. All the real
// logic lives in the sibling modules.

import type { ViewState } from './protocol';
import { send } from './vscodeApi';
import { preserveFocus } from './preserveFocus';
import {
    renderProviderPick,
    renderModelAuthSection,
    renderCommitSection,
    renderRefsSection,
    renderAutomationSection,
    renderCommitlintSection,
    renderAdvancedSection,
} from './sections';

const root = document.getElementById('root') as HTMLElement;

function build(state: ViewState): void {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(renderProviderPick(state));
    fragment.appendChild(renderModelAuthSection(state));
    fragment.appendChild(renderCommitSection(state));
    fragment.appendChild(renderRefsSection(state));
    fragment.appendChild(renderAutomationSection(state));
    fragment.appendChild(renderCommitlintSection(state));
    fragment.appendChild(renderAdvancedSection(state));
    root.innerHTML = '';
    root.appendChild(fragment);
}

// Rebuild the tree but preserve focus/caret/scroll across the swap (see
// preserveFocus) so a setSetting echo can't disrupt an in-progress edit.
function render(state: ViewState): void {
    preserveFocus(() => build(state));
}

// Serialized last-rendered state. Skips redundant pushes (visibility re-push,
// secret change that didn't alter anything we render) so they don't flicker.
let lastRendered = '';

window.addEventListener('message', (event: MessageEvent) => {
    // Only accept messages from the VS Code webview host. The webview always
    // runs under a `vscode-webview://` origin; reject anything else so a framed
    // or injected context cannot post state into the view.
    if (!event.origin.startsWith('vscode-webview://')) {
        return;
    }
    const msg = event.data;
    if (msg?.type === 'state') {
        const json = JSON.stringify(msg.state);
        if (json === lastRendered) {
            return;
        }
        lastRendered = json;
        render(msg.state as ViewState);
    }
});

send({ type: 'getState' });
