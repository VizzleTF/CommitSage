// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preserveFocus } from '../src/views/webview/preserveFocus';

const root = () => document.getElementById('root')!;

function mountInput(id: string, value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.value = value;
    root().appendChild(input);
    return input;
}

// Simulate the real render: blow away #root and rebuild a fresh node carrying
// the same id (controls keep stable ids across rebuilds).
function rebuildWith(id: string, value: string): void {
    root().innerHTML = '';
    mountInput(id, value);
}

beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
});

describe('preserveFocus', () => {
    it('restores focus and caret to the rebuilt node with the same id', () => {
        const input = mountInput('x', 'hello');
        input.focus();
        input.setSelectionRange(1, 3);
        expect(document.activeElement).toBe(input);

        preserveFocus(() => rebuildWith('x', 'hello'));

        const next = document.getElementById('x') as HTMLInputElement;
        expect(next).not.toBe(input); // genuinely rebuilt
        expect(document.activeElement).toBe(next);
        expect(next.selectionStart).toBe(1);
        expect(next.selectionEnd).toBe(3);
    });

    it('keeps unsaved text when the pushed state carries a different value', () => {
        const input = mountInput('x', 'saved');
        input.focus();
        input.value = 'typing in progress';
        input.setSelectionRange(6, 6);

        preserveFocus(() => rebuildWith('x', 'saved'));

        const next = document.getElementById('x') as HTMLInputElement;
        expect(next.value).toBe('typing in progress');
        expect(next.selectionStart).toBe(6);
    });

    it('shows the new pushed value in a focused field the user did not edit', () => {
        const input = mountInput('x', 'old');
        input.defaultValue = 'old';
        input.focus();

        preserveFocus(() => {
            rebuildWith('x', 'new');
            (document.getElementById('x') as HTMLInputElement).defaultValue = 'new';
        });

        const next = document.getElementById('x') as HTMLInputElement;
        expect(document.activeElement).toBe(next);
        expect(next.value).toBe('new');
    });

    it('re-runs a combobox filter on the restored text', () => {
        const input = mountInput('model', 'gpt');
        input.setAttribute('role', 'combobox');
        input.focus();
        const onInput = vi.fn();

        preserveFocus(() => {
            rebuildWith('model', 'other');
            const next = document.getElementById('model') as HTMLInputElement;
            next.setAttribute('role', 'combobox');
            // Real combobox clears itself on focus and filters on `input`.
            next.addEventListener('focus', () => { next.value = ''; });
            next.addEventListener('input', () => onInput(next.value));
        });

        expect((document.getElementById('model') as HTMLInputElement).value).toBe('gpt');
        expect(onInput).toHaveBeenCalledWith('gpt');
    });

    it('runs the rebuild even when nothing is focused', () => {
        const built = vi.fn(() => rebuildWith('y', 'z'));
        preserveFocus(built);
        expect(built).toHaveBeenCalledOnce();
        expect(document.getElementById('y')).not.toBeNull();
    });

    it('does not throw when the focused id is gone after rebuild', () => {
        const input = mountInput('vanishes', 'v');
        input.focus();
        expect(() => preserveFocus(() => { root().innerHTML = ''; })).not.toThrow();
        expect(document.getElementById('vanishes')).toBeNull();
    });

    it('restores scroll position', () => {
        const scrollSpy = vi.spyOn(window, 'scrollTo');
        mountInput('s', 'a');
        preserveFocus(() => rebuildWith('s', 'a'));
        expect(scrollSpy).toHaveBeenCalledWith({ top: window.scrollY });
    });
});
