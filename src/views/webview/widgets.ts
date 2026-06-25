// Reusable labelled form controls built on the `el` helper. Each returns a
// detached DOM node and wires its own change handler to the supplied callback.

import type { ViewState } from './protocol';
import { el } from './dom';
import { L } from './init';
import { ListboxPopup } from './popup';

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
// value lives on `wrap.dataset.value`; state is normally push-based. Popup
// mechanics (DOM, highlight, scroll) live in ListboxPopup — this is the
// adapter that owns the trigger, commit semantics, and keyboard handling.
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

    const popup = new ListboxPopup('select', id, item => commit(item.value, item.label));
    popup.setItems(items, current);

    /* eslint-disable @typescript-eslint/naming-convention */
    const trigger = el('button', {
        type: 'button',
        id: `${id}-trigger`,
        class: 'select-trigger',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
        'aria-controls': popup.listId,
        disabled: opts.disabled,
    }, [valueEl]) as HTMLButtonElement;
    /* eslint-enable @typescript-eslint/naming-convention */

    function syncActiveDescendant(): void {
        const optId = popup.activeOptionId();
        if (optId) {
            trigger.setAttribute('aria-activedescendant', optId);
        } else {
            trigger.removeAttribute('aria-activedescendant');
        }
    }

    function open(): void {
        if (opts.disabled || popup.isOpen) { return; }
        wrap.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        popup.show(wrap.dataset.value);
        syncActiveDescendant();
    }
    function close(): void {
        if (!popup.isOpen) { return; }
        popup.hide();
        wrap.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-activedescendant');
    }

    function commit(value: string, label: string): void {
        wrap.dataset.value = value;
        valueEl.textContent = label;
        popup.markSelected(value);
        close();
        trigger.focus();
        onChange(value);
    }

    trigger.addEventListener('click', () => (popup.isOpen ? close() : open()));

    trigger.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!popup.isOpen) { open(); return; }
            popup.move(e.key === 'ArrowDown' ? 1 : -1);
            syncActiveDescendant();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!popup.isOpen) { open(); } else { popup.commitActive(); }
        } else if (e.key === 'Escape') {
            if (popup.isOpen) { e.preventDefault(); close(); }
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
    wrap.appendChild(popup.list);
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
        // Non-numeric input used to be swallowed silently, leaving the user
        // wondering why nothing saved. Flag it instead (accessible + styled),
        // and only persist a real number.
        if (Number.isNaN(parsed)) {
            input.setAttribute('aria-invalid', 'true');
            return;
        }
        input.removeAttribute('aria-invalid');
        onChange(parsed);
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
