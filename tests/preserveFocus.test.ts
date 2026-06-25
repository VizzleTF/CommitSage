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
