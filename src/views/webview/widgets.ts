// Reusable labelled form controls built on the `el` helper. Each returns a
// detached DOM node and wires its own change handler to the supplied callback.

import type { ViewState } from './protocol';
import { el } from './dom';
import { L } from './init';

export function fieldLabel(text: string): HTMLLabelElement {
    return el('label', { class: 'field' }, [text]);
}

/** True when the setting is pinned by .commitsage/config.json and the control is inert. */
export function isPinned(state: ViewState, keyName: string): boolean {
    return state.projectOverrides.includes(keyName);
}

export function pinnedHint(): HTMLDivElement {
    return el('div', { class: 'hint pinned' }, [
        'Pinned by .commitsage/config.json in this repo — change it there.',
    ]) as HTMLDivElement;
}

// Custom, fully theme-able dropdown (rounded popup, keyboard nav, "selected"
// check) instead of the native <select>, whose popup is drawn by the
// OS/Chromium and cannot be styled (corners, theme) from CSS. Same signature
// as the old native-select version, so callers are unchanged. The committed
// value lives on `wrap.dataset.value`; state is normally push-based.
export function makeSelect(
    id: string,
    options: Array<{ value: string; label: string }>,
    current: string,
    onChange: (value: string) => void,
    opts: { disabled?: boolean } = {},
): HTMLDivElement {
    const items = options.slice();
    // #405: a stored value no longer in the list is still shown to the user.
    if (current && !items.some(o => o.value === current)) {
        items.push({ value: current, label: `${current} ${L.notInList}` });
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const wrap = el('div', { class: 'select', id, 'data-value': current }) as HTMLDivElement;

    const currentLabel = items.find(o => o.value === current)?.label ?? current ?? '';
    const valueEl = el('span', { class: 'select-value' }, [currentLabel]);
    /* eslint-disable @typescript-eslint/naming-convention */
    const trigger = el('button', {
        type: 'button',
        class: 'select-trigger',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
        disabled: opts.disabled,
    }, [valueEl]) as HTMLButtonElement;
    /* eslint-enable @typescript-eslint/naming-convention */

    // Outer clip + inner scroller: the rounded `.select-list` has
    // overflow:hidden so the inner scroller's scrollbar is clipped to the
    // rounded corners (matches the model combobox).
    const list = el('div', { class: 'select-list' }) as HTMLDivElement;
    list.hidden = true;
    const listScroll = el('ul', { class: 'select-list-scroll', role: 'listbox' }) as HTMLUListElement;
    list.appendChild(listScroll);

    let activeIdx = items.findIndex(o => o.value === current);

    const optionEls: HTMLLIElement[] = items.map(o => {
        /* eslint-disable @typescript-eslint/naming-convention */
        const li = el('li', {
            class: 'select-option',
            role: 'option',
            'data-value': o.value,
            'aria-selected': o.value === current ? 'true' : undefined,
        }, [o.label]) as HTMLLIElement;
        /* eslint-enable @typescript-eslint/naming-convention */
        // mousedown (not click): click fires after the trigger's blur, which
        // would already have closed the list and cancelled the pick.
        li.addEventListener('mousedown', e => {
            e.preventDefault();
            commit(o.value, o.label);
        });
        listScroll.appendChild(li);
        return li;
    });

    function highlight(): void {
        optionEls.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
        if (activeIdx >= 0) {
            optionEls[activeIdx].scrollIntoView({ block: 'nearest' });
        }
    }

    function open(): void {
        if (opts.disabled || !list.hidden) { return; }
        list.hidden = false;
        wrap.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        activeIdx = Math.max(0, items.findIndex(o => o.value === wrap.dataset.value));
        highlight();
    }
    function close(): void {
        if (list.hidden) { return; }
        list.hidden = true;
        wrap.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function commit(value: string, label: string): void {
        wrap.dataset.value = value;
        valueEl.textContent = label;
        for (const li of optionEls) {
            if (li.dataset.value === value) {
                li.setAttribute('aria-selected', 'true');
            } else {
                li.removeAttribute('aria-selected');
            }
        }
        close();
        trigger.focus();
        onChange(value);
    }

    trigger.addEventListener('click', () => (list.hidden ? open() : close()));

    trigger.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (list.hidden) { open(); return; }
            activeIdx = e.key === 'ArrowDown'
                ? Math.min(activeIdx + 1, items.length - 1)
                : Math.max(activeIdx - 1, 0);
            highlight();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (list.hidden) {
                open();
            } else if (activeIdx >= 0) {
                commit(items[activeIdx].value, items[activeIdx].label);
            }
        } else if (e.key === 'Escape') {
            if (!list.hidden) { e.preventDefault(); close(); }
        } else if (e.key === 'Tab') {
            close();
        }
    });

    // Close when focus leaves the whole widget (deferred so an option's
    // mousedown can commit before we tear the list down).
    trigger.addEventListener('blur', () => setTimeout(() => {
        if (!wrap.contains(document.activeElement)) { close(); }
    }, 0));

    wrap.appendChild(trigger);
    wrap.appendChild(list);
    return wrap;
}

export function makeCheckbox(
    id: string,
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    opts: { disabled?: boolean; hint?: string } = {},
): HTMLDivElement {
    const input = el('input', { type: 'checkbox', id, disabled: opts.disabled }) as HTMLInputElement;
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const row = el('div', { class: 'checkbox-row' + (opts.disabled ? ' disabled' : '') }, [
        input,
        el('label', { for: id }, [label]),
    ]);
    if (opts.hint) {
        row.appendChild(el('span', { class: 'hint' }, [opts.hint]));
    }
    return row;
}

export function makeTextInput(
    id: string,
    value: string,
    onChange: (v: string) => void,
    placeholder?: string,
): HTMLInputElement {
    // Value set via the property (not the attribute) so it reflects the current
    // value, matching the number/textarea widgets below.
    const input = el('input', { type: 'text', id, placeholder }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    return input;
}

export function makeNumberInput(
    id: string,
    value: number,
    onChange: (v: number) => void,
): HTMLInputElement {
    const input = el('input', { type: 'number', id }) as HTMLInputElement;
    input.value = String(value);
    input.addEventListener('change', () => {
        const parsed = Number.parseFloat(input.value);
        if (!Number.isNaN(parsed)) {
            onChange(parsed);
        }
    });
    return input;
}

export function makeTextarea(
    id: string,
    value: string,
    onChange: (v: string) => void,
): HTMLTextAreaElement {
    const ta = el('textarea', { id, rows: 5 }) as HTMLTextAreaElement;
    ta.value = value;
    ta.addEventListener('change', () => onChange(ta.value));
    return ta;
}
