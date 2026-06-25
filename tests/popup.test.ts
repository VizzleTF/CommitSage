// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListboxPopup, PopupItem } from '../src/views/webview/popup';

const items: PopupItem[] = [
    { value: 'a', label: 'Apple' },
    { value: 'b', label: 'Banana' },
    { value: 'c', label: 'Cherry' },
];

beforeEach(() => {
    document.body.innerHTML = '';
    // happy-dom doesn't implement scrollIntoView; highlight() calls it.
    Element.prototype.scrollIntoView = vi.fn();
});

describe('ListboxPopup', () => {
    it('builds a hidden list + scroll with a stable listbox id', () => {
        const p = new ListboxPopup('select', 'fmt', () => {});
        expect(p.list.className).toBe('select-list');
        expect(p.list.hidden).toBe(true);
        expect(p.isOpen).toBe(false);
        expect(p.listId).toBe('fmt-listbox');
        const scroll = p.list.querySelector('ul')!;
        expect(scroll.id).toBe('fmt-listbox');
        expect(scroll.getAttribute('role')).toBe('listbox');
    });

    it('renders options with id, data-value, role and aria-selected on the match', () => {
        const p = new ListboxPopup('combo', 'model', () => {});
        p.setItems(items, 'b');
        const lis = p.list.querySelectorAll('li');
        expect(lis).toHaveLength(3);
        expect(lis[0].id).toBe('model-opt-0');
        expect(lis[0].className).toBe('combo-list-item');
        expect(lis[0].getAttribute('role')).toBe('option');
        expect(lis[1].getAttribute('data-value')).toBe('b');
        expect(lis[1].getAttribute('aria-selected')).toBe('true');
        expect(lis[0].hasAttribute('aria-selected')).toBe(false);
    });

    it('show() reveals the list and highlights the requested value', () => {
        const p = new ListboxPopup('select', 'fmt', () => {});
        p.setItems(items);
        p.show('b');
        expect(p.isOpen).toBe(true);
        expect(p.list.hidden).toBe(false);
        expect(p.activeItem()).toEqual({ value: 'b', label: 'Banana' });
        expect(p.activeOptionId()).toBe('fmt-opt-1');
        expect(p.list.querySelectorAll('li')[1].classList.contains('active')).toBe(true);
    });

    it('show() with an unknown value falls back to index 0', () => {
        const p = new ListboxPopup('select', 'fmt', () => {});
        p.setItems(items);
        p.show('nope');
        expect(p.activeOptionId()).toBe('fmt-opt-0');
    });

    it('move() clamps within bounds', () => {
        const p = new ListboxPopup('select', 'fmt', () => {});
        p.setItems(items);
        p.show('a');
        p.move(1);
        expect(p.activeItem()?.value).toBe('b');
        p.move(10);
        expect(p.activeItem()?.value).toBe('c');
        p.move(-99);
        expect(p.activeItem()?.value).toBe('a');
    });

    it('commitActive() calls onPick with the highlighted item', () => {
        const onPick = vi.fn();
        const p = new ListboxPopup('select', 'fmt', onPick);
        p.setItems(items);
        p.show('c');
        p.commitActive();
        expect(onPick).toHaveBeenCalledWith({ value: 'c', label: 'Cherry' });
    });

    it('mousedown on an option picks it and prevents default', () => {
        const onPick = vi.fn();
        const p = new ListboxPopup('select', 'fmt', onPick);
        p.setItems(items);
        const li = p.list.querySelectorAll('li')[2];
        const ev = new Event('mousedown', { cancelable: true });
        li.dispatchEvent(ev);
        expect(onPick).toHaveBeenCalledWith({ value: 'c', label: 'Cherry' });
        expect(ev.defaultPrevented).toBe(true);
    });

    it('markSelected() moves aria-selected without a rebuild', () => {
        const p = new ListboxPopup('select', 'fmt', () => {});
        p.setItems(items, 'a');
        p.markSelected('c');
        const lis = p.list.querySelectorAll('li');
        expect(lis[0].hasAttribute('aria-selected')).toBe(false);
        expect(lis[2].getAttribute('aria-selected')).toBe('true');
    });

    it('hide() collapses the list and clears the active option', () => {
        const p = new ListboxPopup('select', 'fmt', () => {});
        p.setItems(items);
        p.show('b');
        p.hide();
        expect(p.isOpen).toBe(false);
        expect(p.list.hidden).toBe(true);
        expect(p.activeItem()).toBeUndefined();
        expect(p.activeOptionId()).toBeUndefined();
    });

    it('move() on an empty list is a no-op', () => {
        const p = new ListboxPopup('select', 'fmt', () => {});
        p.setItems([]);
        p.show();
        p.move(1);
        expect(p.activeItem()).toBeUndefined();
    });
});
