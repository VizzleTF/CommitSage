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

export function makeSelect(
    id: string,
    options: Array<{ value: string; label: string }>,
    current: string,
    onChange: (value: string) => void,
    opts: { disabled?: boolean } = {},
): HTMLSelectElement {
    const select = el('select', { id, disabled: opts.disabled }) as HTMLSelectElement;
    for (const o of options) {
        const opt = el('option', { value: o.value }, [o.label]);
        select.appendChild(opt);
    }
    // If the current value isn't in the list, append it so the user sees what
    // is actually stored. This is the #405 case (deprecated model still in
    // settings).
    if (current && !options.some(o => o.value === current)) {
        select.appendChild(el('option', { value: current }, [`${current} ${L.notInList}`]));
    }
    select.value = current;
    select.addEventListener('change', () => onChange(select.value));
    return select;
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
