// Run a DOM-replacing rebuild while preserving what the user was doing.
//
// Every setSetting round-trips through the host and echoes back as a fresh state
// push, which rebuilds the whole tree. Without this, an echo (or any async push
// like a finished model refresh) would steal focus, reset the caret, and jump
// the scroll mid-edit. Controls carry stable ids, so re-querying by id
// reattaches focus + selection to the rebuilt node.
//
// Kept separate from main.ts so it's a single-responsibility, unit-testable
// unit (no ViewState or vscode-api dependency).
export function preserveFocus(rebuild: () => void): void {
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const activeId = active?.id || null;
    const selStart = active?.selectionStart ?? null;
    const selEnd = active?.selectionEnd ?? null;
    const scrollY = window.scrollY;

    rebuild();

    if (activeId) {
        const next = document.getElementById(activeId) as HTMLInputElement | null;
        if (next) {
            next.focus();
            if (selStart !== null && typeof next.setSelectionRange === 'function') {
                try {
                    next.setSelectionRange(selStart, selEnd ?? selStart);
                } catch {
                    // Non-text inputs reject setSelectionRange — ignore.
                }
            }
        }
    }
    window.scrollTo({ top: scrollY });
}
