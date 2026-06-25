// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCombobox } from '../src/views/webview/combobox';

const MODELS = ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'llama-3'];

function mount(current = 'gpt-4o', onChange = vi.fn()) {
    const wrap = makeCombobox('model', MODELS, current, onChange);
    document.body.appendChild(wrap);
    const input = wrap.querySelector('input') as HTMLInputElement;
    return { wrap, input, onChange };
}

function key(input: HTMLElement, k: string): void {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true }));
}

beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = vi.fn();
});

describe('makeCombobox', () => {
    it('renders an ARIA combobox input wired to the listbox', () => {
        const { input } = mount();
        expect(input.getAttribute('role')).toBe('combobox');
        expect(input.getAttribute('aria-autocomplete')).toBe('list');
        expect(input.getAttribute('aria-expanded')).toBe('false');
        expect(input.getAttribute('aria-controls')).toBe('model-listbox');
        expect(input.value).toBe('gpt-4o');
    });

    it('opens the full list on focus and marks aria-expanded', () => {
        const { wrap, input } = mount();
        input.dispatchEvent(new Event('focus'));
        expect(input.getAttribute('aria-expanded')).toBe('true');
        const lis = wrap.querySelectorAll('li');
        expect(lis).toHaveLength(MODELS.length);
        // committed value pre-highlighted
        expect(input.getAttribute('aria-activedescendant')).toBe('model-opt-0');
    });

    it('fuzzy-filters as the user types', () => {
        const { wrap, input } = mount();
        input.dispatchEvent(new Event('focus'));
        input.value = 'claude';
        input.dispatchEvent(new Event('input'));
        const labels = [...wrap.querySelectorAll('li')].map(li => li.textContent);
        expect(labels).toEqual(['claude-3-5-sonnet']);
    });

    it('commits the highlighted item on Enter and calls onChange', () => {
        const { input, onChange } = mount('gpt-4o');
        input.dispatchEvent(new Event('focus'));
        input.value = 'mini';
        input.dispatchEvent(new Event('input'));
        key(input, 'Enter');
        expect(onChange).toHaveBeenCalledWith('gpt-4o-mini');
        expect(input.value).toBe('gpt-4o-mini');
        expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('commits free-form text not present in the list', () => {
        const { input, onChange } = mount();
        input.dispatchEvent(new Event('focus'));
        input.value = 'my-custom-model';
        input.dispatchEvent(new Event('input')); // no matches -> list hidden
        key(input, 'Enter');
        expect(onChange).toHaveBeenCalledWith('my-custom-model');
    });

    it('Escape restores the committed value without firing onChange', () => {
        const { input, onChange } = mount('gpt-4o');
        input.dispatchEvent(new Event('focus'));
        input.value = 'llama';
        input.dispatchEvent(new Event('input'));
        key(input, 'Escape');
        expect(onChange).not.toHaveBeenCalled();
        expect(input.value).toBe('gpt-4o');
    });

    it('ArrowDown opens the list when closed', () => {
        const { input } = mount();
        expect(input.getAttribute('aria-expanded')).toBe('false');
        key(input, 'ArrowDown');
        expect(input.getAttribute('aria-expanded')).toBe('true');
    });

    it('ArrowDown moves the active descendant when open', () => {
        const { input } = mount();
        input.dispatchEvent(new Event('focus'));
        key(input, 'ArrowDown');
        expect(input.getAttribute('aria-activedescendant')).toBe('model-opt-1');
    });

    it('mousedown on an option commits it', () => {
        const { wrap, input, onChange } = mount();
        input.dispatchEvent(new Event('focus'));
        const target = [...wrap.querySelectorAll('li')].find(li => li.getAttribute('data-value') === 'llama-3')!;
        target.dispatchEvent(new Event('mousedown', { cancelable: true }));
        expect(onChange).toHaveBeenCalledWith('llama-3');
    });

    it('ArrowUp moves the active descendant up when open', () => {
        const { input } = mount();
        input.dispatchEvent(new Event('focus'));
        key(input, 'ArrowDown'); // opt-0 -> opt-1
        expect(input.getAttribute('aria-activedescendant')).toBe('model-opt-1');
        key(input, 'ArrowUp'); // opt-1 -> opt-0
        expect(input.getAttribute('aria-activedescendant')).toBe('model-opt-0');
    });

    it('restores the committed value when blurred with the list open', () => {
        vi.useFakeTimers();
        try {
            const { input, onChange } = mount('gpt-4o');
            input.dispatchEvent(new Event('focus'));
            input.value = 'llama';
            input.dispatchEvent(new Event('input')); // list open with a match
            input.dispatchEvent(new Event('blur'));
            vi.runAllTimers(); // blur handler is deferred
            expect(input.value).toBe('gpt-4o');
            expect(onChange).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('marks the input disabled', () => {
        const wrap = makeCombobox('model', MODELS, 'gpt-4o', vi.fn(), undefined, { disabled: true });
        const input = wrap.querySelector('input') as HTMLInputElement;
        expect(input.disabled).toBe(true);
    });
});
