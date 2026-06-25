// Collapsible <details> section with open/closed state persisted via
// vscode.setState, so the webview restores the previous expansion across
// reloads / window restarts. Keys are stable section IDs ("modelAuth" /
// "commit" / "automation" / "advanced") — not localized titles, which would
// change with locale.

import { el } from './dom';
import { vscode } from './vscodeApi';

type SectionState = Record<string, boolean>;

// Cached after the first read: section() runs once per section on every render
// (6×), and this module is the only writer of the `sections` slice, so reading
// vscode.getState() each time was redundant. The cache stays in sync because
// saveSectionState updates it alongside the persisted copy.
let cache: SectionState | null = null;

function loadSectionState(): SectionState {
    if (cache === null) {
        const raw = vscode.getState() as { sections?: SectionState } | undefined;
        cache = raw?.sections ?? {};
    }
    return cache;
}

function saveSectionState(state: SectionState): void {
    cache = state;
    const prev = (vscode.getState() as Record<string, unknown> | undefined) ?? {};
    vscode.setState({ ...prev, sections: state });
}

export function section(
    id: string,
    title: string,
    openByDefault: boolean,
    body: HTMLElement,
): HTMLDetailsElement {
    const persisted = loadSectionState();
    const open = id in persisted ? persisted[id] : openByDefault;
    const details = el('details', { open: open || undefined }) as HTMLDetailsElement;
    details.appendChild(el('summary', undefined, [title]));
    const wrap = el('div', { class: 'body' }, [body]);
    details.appendChild(wrap);

    details.addEventListener('toggle', () => {
        const next = loadSectionState();
        next[id] = details.open;
        saveSectionState(next);
    });

    return details;
}
