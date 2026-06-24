import { el } from './dom';
import { fuzzyScore } from '../../utils/fuzzyMatch';

/**
 * Custom combobox: text input + scrollable popup list with substring
 * filtering, keyboard navigation, and free-form entry. Replaces the
 * browser-native `<datalist>` which had two blockers:
 *  1. Chromium's datalist popup doesn't scroll past ~20 items (OpenRouter
 *     ships 300+ models).
 *  2. There's no way to clear the input on focus while preserving the
 *     committed value — datalist tightly couples display and value.
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
    const input = el('input', {
        type: 'text',
        id,
        autocomplete: 'off',
        spellcheck: 'false',
        disabled: opts.disabled,
        placeholder: current || placeholder || '',
    }) as HTMLInputElement;
    input.value = current;

    const list = el('ul', { class: 'combo-list' }) as HTMLUListElement;
    list.hidden = true;

    let committed = current;
    let activeIdx = -1;

    function renderList(filter: string): void {
        const f = filter.trim();
        let matches: string[];
        if (f) {
            const scored: Array<{ value: string; score: number }> = [];
            for (const o of options) {
                const s = fuzzyScore(f, o);
                if (s !== null) {
                    scored.push({ value: o, score: s });
                }
            }
            // Higher score first; lexicographic as tiebreaker so the order
            // is stable across renders.
            scored.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
            matches = scored.map(s => s.value);
        } else {
            matches = options.slice();
        }

        list.innerHTML = '';
        if (matches.length === 0) {
            list.hidden = true;
            activeIdx = -1;
            return;
        }
        for (const value of matches) {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const li = el('li', { class: 'combo-list-item', 'data-value': value }, [value]);
            // mousedown (not click) — click fires AFTER input blur, which
            // would hide the list and cancel the selection. mousedown +
            // preventDefault keeps focus.
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                commit(value);
            });
            list.appendChild(li);
        }
        list.hidden = false;
        // When the user is filtering, always start from the top match. When
        // the filter is empty (e.g. on focus), pre-highlight the committed
        // value so the dropdown opens on the user's current selection.
        if (!f && committed) {
            activeIdx = Math.max(0, matches.indexOf(committed));
        } else {
            activeIdx = 0;
        }
        highlight();
    }

    function highlight(): void {
        const items = list.querySelectorAll('.combo-list-item');
        items.forEach((it, i) => {
            it.classList.toggle('active', i === activeIdx);
            if (i === activeIdx) {
                (it as HTMLElement).scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function commit(value: string): void {
        committed = value;
        input.value = value;
        input.placeholder = value || (placeholder ?? '');
        list.hidden = true;
        activeIdx = -1;
        onChange(value);
    }

    function restore(): void {
        input.value = committed;
        list.hidden = true;
        activeIdx = -1;
    }

    function openList(): void {
        // Clear the typed display so the filter starts empty and the user
        // sees the full list. `committed` is unchanged — restore() puts it
        // back if the user closes without picking.
        input.value = '';
        input.placeholder = committed || (placeholder ?? '');
        renderList('');
    }

    input.addEventListener('focus', openList);
    // Re-opening on click handles the case where the input already has focus
    // but the list was closed (e.g. Esc was pressed).
    input.addEventListener('click', () => {
        if (list.hidden) {
            openList();
        }
    });

    input.addEventListener('blur', () => {
        // Defer so a mousedown on a list item can commit first.
        setTimeout(() => {
            if (!list.hidden) {
                restore();
            } else if (input.value !== committed) {
                // List already closed (e.g. via commit) but if input still
                // shows a stale typed value, sync to committed.
                input.value = committed;
            }
        }, 0);
    });

    input.addEventListener('input', () => renderList(input.value));

    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            if (list.hidden) {
                openList();
            } else {
                const items = list.querySelectorAll('.combo-list-item');
                activeIdx = Math.min(activeIdx + 1, items.length - 1);
                highlight();
            }
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            if (!list.hidden) {
                activeIdx = Math.max(activeIdx - 1, 0);
                highlight();
                e.preventDefault();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const items = list.querySelectorAll('.combo-list-item');
            if (!list.hidden && activeIdx >= 0 && activeIdx < items.length) {
                commit((items[activeIdx] as HTMLElement).dataset.value ?? '');
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
    wrap.appendChild(list);
    return wrap;
}
