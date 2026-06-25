import { el } from './dom';
import { fuzzyScore } from '../../utils/fuzzyMatch';
import { ListboxPopup, PopupItem } from './popup';

/**
 * Custom combobox: text input + scrollable popup list with fuzzy filtering,
 * keyboard navigation, and free-form entry. Replaces the browser-native
 * `<datalist>` which had two blockers:
 *  1. Chromium's datalist popup doesn't scroll past ~20 items (OpenRouter
 *     ships 300+ models).
 *  2. There's no way to clear the input on focus while preserving the
 *     committed value — datalist tightly couples display and value.
 *
 * Popup mechanics (DOM, highlight, scroll) live in ListboxPopup; this adapter
 * owns the input, filtering, free-form commit, and keyboard handling.
 *
 * Behaviour:
 *  - Focus clears the input to an empty filter (placeholder shows the
 *     committed model), so the user immediately sees the full list.
 *  - The committed value is preserved — closing without selecting (Esc /
 *     click outside / blur) restores the displayed value.
 *  - Selection (click / Enter on highlighted item) commits + calls onChange.
 *  - Pressing Enter on free-form text not in the list also commits it,
 *     so brand-new model IDs can be typed in.
 *  - ↑/↓ navigate, Esc closes without commit.
 */
export function makeCombobox(
    id: string,
    options: string[],
    current: string,
    onChange: (value: string) => void,
    placeholder?: string,
    opts: { disabled?: boolean } = {},
): HTMLDivElement {
    const wrap = el('div', { class: 'combo' }) as HTMLDivElement;

    let committed = current;
    const popup = new ListboxPopup('combo', id, item => commit(item.value));

    /* eslint-disable @typescript-eslint/naming-convention */
    const input = el('input', {
        type: 'text',
        id,
        autocomplete: 'off',
        spellcheck: 'false',
        role: 'combobox',
        'aria-autocomplete': 'list',
        'aria-expanded': 'false',
        'aria-controls': popup.listId,
        disabled: opts.disabled,
        placeholder: current || placeholder || '',
    }) as HTMLInputElement;
    /* eslint-enable @typescript-eslint/naming-convention */
    input.value = current;

    function setExpanded(open: boolean): void {
        input.setAttribute('aria-expanded', String(open));
        if (!open) { input.removeAttribute('aria-activedescendant'); }
    }
    function syncActiveDescendant(): void {
        const optId = popup.activeOptionId();
        if (optId) {
            input.setAttribute('aria-activedescendant', optId);
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    }

    function filtered(filter: string): PopupItem[] {
        const f = filter.trim();
        if (!f) {
            return options.map(v => ({ value: v, label: v }));
        }
        const scored: Array<{ value: string; score: number }> = [];
        for (const o of options) {
            const s = fuzzyScore(f, o);
            if (s !== null) { scored.push({ value: o, score: s }); }
        }
        // Higher score first; lexicographic tiebreak so order is stable.
        scored.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
        return scored.map(s => ({ value: s.value, label: s.value }));
    }

    function renderList(filter: string): void {
        const matches = filtered(filter);
        popup.setItems(matches, committed);
        if (matches.length === 0) {
            popup.hide();
            setExpanded(false);
            return;
        }
        // Empty filter (e.g. on focus): open on the committed value. While
        // filtering: start from the top match.
        const f = filter.trim();
        popup.show(!f && committed ? committed : matches[0].value);
        setExpanded(true);
        syncActiveDescendant();
    }

    function commit(value: string): void {
        committed = value;
        input.value = value;
        input.placeholder = value || (placeholder ?? '');
        popup.hide();
        setExpanded(false);
        // Drop focus so the setSetting echo rebuild doesn't refocus the input
        // and re-trigger openList. Matches the pre-popup behaviour.
        input.blur();
        onChange(value);
    }

    function restore(): void {
        input.value = committed;
        popup.hide();
        setExpanded(false);
    }

    function openList(): void {
        // Clear the typed display so the filter starts empty and the user sees
        // the full list. `committed` is unchanged — restore() puts it back if
        // the user closes without picking.
        input.value = '';
        input.placeholder = committed || (placeholder ?? '');
        renderList('');
    }

    input.addEventListener('focus', openList);
    // Re-open on click when the input already has focus but the list is closed
    // (e.g. Esc was pressed).
    input.addEventListener('click', () => {
        if (!popup.isOpen) { openList(); }
    });

    input.addEventListener('blur', () => {
        // Defer so a mousedown on a list item can commit first.
        setTimeout(() => {
            if (popup.isOpen) {
                restore();
            } else if (input.value !== committed) {
                // List already closed (e.g. via commit) but the input still
                // shows a stale typed value — sync to committed.
                input.value = committed;
            }
        }, 0);
    });

    input.addEventListener('input', () => renderList(input.value));

    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!popup.isOpen) { openList(); } else { popup.move(1); syncActiveDescendant(); }
        } else if (e.key === 'ArrowUp') {
            if (popup.isOpen) { e.preventDefault(); popup.move(-1); syncActiveDescendant(); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (popup.isOpen && popup.activeItem()) {
                commit(popup.activeItem()!.value);
            } else if (input.value.trim()) {
                // Free-form entry: commit whatever the user typed.
                commit(input.value.trim());
            } else {
                restore();
            }
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            restore();
            input.blur();
        }
    });

    wrap.appendChild(input);
    wrap.appendChild(popup.list);
    return wrap;
}
