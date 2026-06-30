// Shared rounded popup-listbox used by both dropdowns (makeSelect, makeCombobox).
//
// Single responsibility (SRP): the popup *mechanics* only — the clipped DOM
// skeleton, option rendering, active-index highlight with scrollIntoView, and
// show/hide. Keyboard handling and commit semantics differ between the two
// widgets (button vs filterable input, fixed list vs free-form entry), so those
// stay in the thin adapters. This removes the ~40 lines of identical list
// mechanics the two widgets used to duplicate.

import { el } from './dom';

export interface PopupItem { value: string; label: string; dot?: boolean }

export class ListboxPopup {
    /** Outer clipped container — the adapter appends this into its wrapper. */
    readonly list: HTMLDivElement;
    /** Stable id so the trigger can point `aria-controls` at the listbox. */
    readonly listId: string;

    private readonly scroll: HTMLUListElement;
    private items: PopupItem[] = [];
    private optionEls: HTMLLIElement[] = [];
    private activeIdx = -1;

    constructor(
        private readonly prefix: 'combo' | 'select',
        private readonly idBase: string,
        private readonly onPick: (item: PopupItem) => void,
    ) {
        this.listId = `${idBase}-listbox`;
        this.list = el('div', { class: `${prefix}-list` }) as HTMLDivElement;
        this.list.hidden = true;
        this.scroll = el('ul', {
            class: `${prefix}-list-scroll`,
            role: 'listbox',
            id: this.listId,
        }) as HTMLUListElement;
        this.list.appendChild(this.scroll);
    }

    get isOpen(): boolean { return !this.list.hidden; }
    activeItem(): PopupItem | undefined { return this.items[this.activeIdx]; }
    /** id of the highlighted option, for the trigger's `aria-activedescendant`. */
    activeOptionId(): string | undefined {
        return this.activeIdx >= 0 ? this.optionEls[this.activeIdx]?.id : undefined;
    }

    /** Rebuild the options. `selected` marks one `aria-selected`. */
    setItems(items: PopupItem[], selected?: string): void {
        this.items = items;
        this.scroll.innerHTML = '';
        this.optionEls = items.map((item, i) => {
            /* eslint-disable @typescript-eslint/naming-convention */
            const li = el('li', {
                class: `${this.prefix}-list-item`,
                role: 'option',
                id: `${this.idBase}-opt-${i}`,
                'data-value': item.value,
                'aria-selected': item.value === selected ? 'true' : undefined,
            }, item.dot
                ? [el('span', { class: `${this.prefix}-dot` }), item.label]
                : [item.label]) as HTMLLIElement;
            /* eslint-enable @typescript-eslint/naming-convention */
            // mousedown (not click): click fires after the trigger's blur, which
            // would already have closed the list and cancelled the pick.
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                this.onPick(item);
            });
            this.scroll.appendChild(li);
            return li;
        });
    }

    /** Move `aria-selected` to `value` without rebuilding the list. */
    markSelected(value: string): void {
        for (const li of this.optionEls) {
            if (li.dataset.value === value) {
                li.setAttribute('aria-selected', 'true');
            } else {
                li.removeAttribute('aria-selected');
            }
        }
    }

    /** Open and, if given, highlight the option whose value matches. */
    show(activeValue?: string): void {
        this.list.hidden = false;
        if (activeValue !== undefined) {
            this.activeIdx = Math.max(0, this.items.findIndex(o => o.value === activeValue));
        }
        this.highlight();
    }

    hide(): void {
        this.list.hidden = true;
        this.activeIdx = -1;
    }

    move(delta: number): void {
        if (this.items.length === 0) { return; }
        this.activeIdx = Math.min(Math.max(this.activeIdx + delta, 0), this.items.length - 1);
        this.highlight();
    }

    setActive(idx: number): void {
        this.activeIdx = idx;
        this.highlight();
    }

    commitActive(): void {
        const item = this.activeItem();
        if (item) { this.onPick(item); }
    }

    private highlight(): void {
        this.optionEls.forEach((li, i) => li.classList.toggle('active', i === this.activeIdx));
        if (this.activeIdx >= 0) {
            this.optionEls[this.activeIdx]?.scrollIntoView({ block: 'nearest' });
        }
    }
}
