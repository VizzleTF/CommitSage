// Run a DOM-replacing rebuild while preserving what the user was doing.
//
// Every setSetting round-trips through the host and echoes back as a fresh state
// push, which rebuilds the whole tree. Without this, an echo (or any async push
// like a finished model refresh) would steal focus, reset the caret, drop the
// text being typed, and jump the scroll mid-edit. Controls carry stable ids, so
// re-querying by id reattaches focus, draft text and selection to the rebuilt
// node.
//
// Kept separate from main.ts so it's a single-responsibility, unit-testable
// unit (no ViewState or vscode-api dependency).
export function preserveFocus(rebuild: () => void): void {
    const active = document.activeElement;
    const activeId = active?.id || null;
    // Text fields save on `change` (blur), so an unsaved edit lives only in the
    // DOM. An untouched field takes the pushed value (it may have changed elsewhere).
    const draft = isTextField(active) && active.value !== active.defaultValue ? active.value : null;
    const selStart = isTextField(active) ? active.selectionStart : null;
    const selEnd = isTextField(active) ? active.selectionEnd : null;
    const scrollY = window.scrollY;

    rebuild();

    if (activeId) {
        const next = document.getElementById(activeId);
        if (next) {
            next.focus();
            if (isTextField(next)) {
                if (draft !== null && !next.disabled) {
                    next.value = draft;
                    // The combobox empties itself on focus; re-run its filter
                    // on the restored text.
                    if (next.getAttribute('role') === 'combobox') {
                        next.dispatchEvent(new Event('input'));
                    }
                }
                if (selStart !== null) {
                    try {
                        next.setSelectionRange(selStart, selEnd ?? selStart);
                    } catch {
                        // Non-text inputs (number) reject setSelectionRange — ignore.
                    }
                }
            }
        }
    }
    window.scrollTo({ top: scrollY });
}

function isTextField(node: Element | null): node is HTMLInputElement | HTMLTextAreaElement {
    return node instanceof HTMLTextAreaElement
        || (node instanceof HTMLInputElement && node.type !== 'checkbox');
}
