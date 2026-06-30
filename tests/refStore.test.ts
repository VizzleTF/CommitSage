import { describe, it, expect, beforeEach } from 'vitest';
import { RefStore } from '../src/services/refStore';

// Minimal in-memory Memento standing in for context.workspaceState.
function fakeContext() {
    const store = new Map<string, unknown>();
    return {
        workspaceState: {
            get: <T>(key: string, def?: T) => (store.has(key) ? (store.get(key) as T) : def),
            update: (key: string, value: unknown) => {
                if (value === undefined) {
                    store.delete(key);
                } else {
                    store.set(key, value);
                }
                return Promise.resolve();
            },
        },
    } as unknown as Parameters<typeof RefStore.init>[0];
}

describe('RefStore', () => {
    beforeEach(() => {
        RefStore.init(fakeContext());
    });

    it('returns undefined for an unknown branch', () => {
        expect(RefStore.getBranchRef('feature/x')).toBeUndefined();
    });

    it('saves and reads a branch ref', async () => {
        await RefStore.setBranchRef('feature/x', 'PROJ-1');
        expect(RefStore.getBranchRef('feature/x')).toBe('PROJ-1');
    });

    it('keeps branch refs independent', async () => {
        await RefStore.setBranchRef('feature/x', 'PROJ-1');
        await RefStore.setBranchRef('feature/y', 'PROJ-2');
        expect(RefStore.getBranchRef('feature/x')).toBe('PROJ-1');
        expect(RefStore.getBranchRef('feature/y')).toBe('PROJ-2');
    });

    it('trims whitespace on save', async () => {
        await RefStore.setBranchRef('main', '  ABC-9  ');
        expect(RefStore.getBranchRef('main')).toBe('ABC-9');
    });

    it('clears a branch ref', async () => {
        await RefStore.setBranchRef('main', 'ABC-9');
        await RefStore.clearBranchRef('main');
        expect(RefStore.getBranchRef('main')).toBeUndefined();
    });

    it('saving an empty value clears the entry', async () => {
        await RefStore.setBranchRef('main', 'ABC-9');
        await RefStore.setBranchRef('main', '   ');
        expect(RefStore.getBranchRef('main')).toBeUndefined();
    });

    it('ignores an empty branch name', () => {
        expect(RefStore.getBranchRef('')).toBeUndefined();
    });
});
