// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// init.ts parses #init-data at module load, so it must exist BEFORE the module
// under test is imported. Set it up, then dynamic-import widgets.
const initEl = document.createElement('script');
initEl.id = 'init-data';
initEl.textContent = JSON.stringify({
    providers: [], languages: [], formats: [],
    commitlintCompatFormats: [], noRefreshProviders: [],
    settingKeys: {}, apiKeyUrls: {},
    l10n: { notInList: '(not in live list)' },
});
document.body.appendChild(initEl);

const {
    makeNumberInput, makeCheckbox, makeTextInput, makeTextarea, makeSelect,
    fieldLabel, isPinned, pinnedHint,
} = await import('../src/views/webview/widgets');

function key(target: HTMLElement, k: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true }));
}

beforeEach(() => {
    // Keep #init-data; just clear any mounted widgets.
    [...document.body.children].forEach(c => { if (c.id !== 'init-data') c.remove(); });
    Element.prototype.scrollIntoView = vi.fn();
});

describe('makeNumberInput', () => {
    it('persists a valid number and clears the invalid flag', () => {
        const onChange = vi.fn();
        const input = makeNumberInput('n', 30, onChange);
        input.value = '42';
        input.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenCalledWith(42);
        expect(input.hasAttribute('aria-invalid')).toBe(false);
    });

    it('flags non-numeric input as invalid and does not persist', () => {
        const onChange = vi.fn();
        const input = makeNumberInput('n', 30, onChange);
        input.value = ''; // number input sanitizes garbage to '' -> NaN
        input.dispatchEvent(new Event('change'));
        expect(onChange).not.toHaveBeenCalled();
        expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('clears the invalid flag once a valid number is entered', () => {
        const onChange = vi.fn();
        const input = makeNumberInput('n', 30, onChange);
        input.value = '';
        input.dispatchEvent(new Event('change'));
        expect(input.getAttribute('aria-invalid')).toBe('true');
        input.value = '7';
        input.dispatchEvent(new Event('change'));
        expect(input.hasAttribute('aria-invalid')).toBe(false);
        expect(onChange).toHaveBeenCalledWith(7);
    });
});

describe('makeCheckbox', () => {
    it('reports the toggled state', () => {
        const onChange = vi.fn();
        const row = makeCheckbox('c', 'Label', false, onChange);
        const input = row.querySelector('input') as HTMLInputElement;
        expect(input.checked).toBe(false);
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('renders disabled state and an optional hint', () => {
        const row = makeCheckbox('c', 'Label', true, () => {}, { disabled: true, hint: 'why' });
        expect(row.classList.contains('disabled')).toBe(true);
        expect((row.querySelector('input') as HTMLInputElement).disabled).toBe(true);
        expect(row.querySelector('.hint')?.textContent).toBe('why');
    });
});

describe('makeTextInput', () => {
    it('emits the changed value', () => {
        const onChange = vi.fn();
        const input = makeTextInput('t', 'old', onChange);
        expect(input.value).toBe('old');
        input.value = 'new';
        input.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenCalledWith('new');
    });
});

describe('makeTextarea', () => {
    it('emits the changed value', () => {
        const onChange = vi.fn();
        const ta = makeTextarea('ta', 'seed', onChange);
        expect(ta.value).toBe('seed');
        ta.value = 'edited';
        ta.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenCalledWith('edited');
    });
});

describe('small helpers', () => {
    it('fieldLabel renders a .field label', () => {
        const l = fieldLabel('Model');
        expect(l.className).toBe('field');
        expect(l.textContent).toBe('Model');
    });

    it('isPinned reflects projectOverrides membership', () => {
        const state = { projectOverrides: ['commitFormat'] } as never;
        expect(isPinned(state, 'commitFormat')).toBe(true);
        expect(isPinned(state, 'provider')).toBe(false);
    });

    it('pinnedHint renders the .hint.pinned note', () => {
        const h = pinnedHint();
        expect(h.className).toBe('hint pinned');
        expect(h.textContent).toContain('.commitsage/config.json');
    });
});

describe('makeSelect', () => {
    it('shows the current option label and commits a pick', () => {
        const onChange = vi.fn();
        const wrap = makeSelect('format', [
            { value: 'conventional', label: 'Conventional' },
            { value: 'angular', label: 'Angular' },
        ], 'conventional', onChange);
        document.body.appendChild(wrap);

        const trigger = wrap.querySelector('.select-trigger') as HTMLButtonElement;
        expect(trigger.id).toBe('format-trigger');
        expect(trigger.getAttribute('aria-controls')).toBe('format-listbox');
        expect(wrap.querySelector('.select-value')?.textContent).toBe('Conventional');

        const angular = [...wrap.querySelectorAll('li')].find(li => li.getAttribute('data-value') === 'angular')!;
        angular.dispatchEvent(new Event('mousedown', { cancelable: true }));
        expect(onChange).toHaveBeenCalledWith('angular');
        expect(wrap.dataset.value).toBe('angular');
        expect(wrap.querySelector('.select-value')?.textContent).toBe('Angular');
    });

    it('surfaces a stored value missing from the list (#405)', () => {
        const wrap = makeSelect('format', [
            { value: 'conventional', label: 'Conventional' },
        ], 'ghost', () => {});
        const labels = [...wrap.querySelectorAll('li')].map(li => li.textContent);
        expect(labels).toContain('ghost (not in live list)');
    });

    it('opens on trigger click and toggles aria-expanded', () => {
        const wrap = makeSelect('format', [
            { value: 'a', label: 'A' }, { value: 'b', label: 'B' },
        ], 'a', () => {});
        document.body.appendChild(wrap);
        const trigger = wrap.querySelector('.select-trigger') as HTMLButtonElement;
        trigger.dispatchEvent(new Event('click'));
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(wrap.classList.contains('open')).toBe(true);
    });

    it('navigates with the keyboard: ArrowDown opens, moves, Enter commits', () => {
        const onChange = vi.fn();
        const wrap = makeSelect('format', [
            { value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' },
        ], 'a', onChange);
        document.body.appendChild(wrap);
        const trigger = wrap.querySelector('.select-trigger') as HTMLButtonElement;

        key(trigger, 'ArrowDown'); // open
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        key(trigger, 'ArrowDown'); // a -> b
        expect(trigger.getAttribute('aria-activedescendant')).toBe('format-opt-1');
        key(trigger, 'ArrowUp'); // b -> a
        expect(trigger.getAttribute('aria-activedescendant')).toBe('format-opt-0');
        key(trigger, 'Enter'); // commit a
        expect(onChange).toHaveBeenCalledWith('a');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('Escape closes without committing; Tab closes', () => {
        const onChange = vi.fn();
        const wrap = makeSelect('format', [
            { value: 'a', label: 'A' }, { value: 'b', label: 'B' },
        ], 'a', onChange);
        document.body.appendChild(wrap);
        const trigger = wrap.querySelector('.select-trigger') as HTMLButtonElement;

        key(trigger, 'Enter'); // open (closed -> open)
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        key(trigger, 'Escape');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(onChange).not.toHaveBeenCalled();

        key(trigger, 'ArrowDown'); // open again
        key(trigger, 'Tab');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('does not open when disabled', () => {
        const wrap = makeSelect('format', [
            { value: 'a', label: 'A' },
        ], 'a', () => {}, { disabled: true });
        document.body.appendChild(wrap);
        const trigger = wrap.querySelector('.select-trigger') as HTMLButtonElement;
        expect(trigger.disabled).toBe(true);
        trigger.dispatchEvent(new Event('click'));
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });
});
