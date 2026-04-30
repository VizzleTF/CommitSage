import { describe, it, expect } from 'vitest';
import { isDeletedStatus, isNewStatus } from '../src/services/gitService';

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
});
