import { describe, it, expect } from 'vitest';
import { isDeletedStatus, isNewStatus, isIndexStaged, isStagedStatus } from '../src/services/gitService';

describe('git porcelain status decoding (F043)', () => {
    describe('isDeletedStatus', () => {
        it.each([
            [' D', true],
            ['D ', true],
            ['DM', false],
            ['MD', false],
            ['??', false],
            ['M ', false],
            [' M', false],
            ['A ', false],
        ])('decodes %s → %s', (status, expected) => {
            expect(isDeletedStatus(status)).toBe(expected);
        });
    });

    describe('isNewStatus', () => {
        it.each([
            ['??', true],
            ['A ', true],
            ['AM', false],
            ['MA', false],
            ['M ', false],
            [' M', false],
            ['D ', false],
            [' D', false],
        ])('decodes %s → %s', (status, expected) => {
            expect(isNewStatus(status)).toBe(expected);
        });
    });

    // isIndexStaged powers the porcelain-derived staged flag in CommitWorkflow;
    // it must match `git diff --cached --name-only` (any index code that isn't
    // unmodified ' ' or untracked '?').
    describe('isIndexStaged', () => {
        it.each([
            ['M ', true],   // staged modify
            ['MM', true],   // staged + further unstaged modify
            ['A ', true],   // staged add
            ['D ', true],   // staged delete
            ['R ', true],   // staged rename
            ['C ', true],   // staged copy
            ['T ', true],   // staged typechange
            [' M', false],  // unstaged-only modify
            [' D', false],  // unstaged-only delete
            ['??', false],  // untracked
        ])('decodes %s → %s', (status, expected) => {
            expect(isIndexStaged(status)).toBe(expected);
        });
    });

    // isStagedStatus is the changed-files staged filter (M/A/D/R only).
    describe('isStagedStatus', () => {
        it.each([
            ['M ', true],
            ['A ', true],
            ['D ', true],
            ['R ', true],
            [' M', false],
            ['??', false],
        ])('decodes %s → %s', (status, expected) => {
            expect(isStagedStatus(status)).toBe(expected);
        });
    });
});
