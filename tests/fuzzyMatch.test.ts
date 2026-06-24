import { describe, it, expect } from 'vitest';
import { fuzzyScore } from '../src/utils/fuzzyMatch';

describe('fuzzyScore', () => {
    it('returns 0 for an empty query (matches everything equally)', () => {
        expect(fuzzyScore('', 'anything')).toBe(0);
    });

    it('is case-insensitive', () => {
        expect(fuzzyScore('CLAUDE', 'claude-3-5-sonnet')).not.toBeNull();
        expect(fuzzyScore('claude', 'CLAUDE-3-5-SONNET')).not.toBeNull();
    });

    describe('tier 1 — contiguous substring', () => {
        it('matches a contiguous substring', () => {
            expect(fuzzyScore('claude', 'claude-3-5-sonnet')).not.toBeNull();
        });

        it('ranks an earlier match position higher', () => {
            const early = fuzzyScore('claude', 'claude-3-5-sonnet')!;
            const late = fuzzyScore('claude', 'meta/some-claude-fork')!;
            expect(early).toBeGreaterThan(late);
        });

        it('outranks a subsequence (tier 2) match', () => {
            const substring = fuzzyScore('cla', 'claude')!;       // tier 1
            const subsequence = fuzzyScore('cla', 'c-l-a-x')!;    // tier 2
            expect(substring).toBeGreaterThan(subsequence);
        });
    });

    describe('tier 2 — ordered subsequence', () => {
        it('matches chars in order with gaps', () => {
            expect(fuzzyScore('clu', 'claude')).not.toBeNull();
        });

        it('ranks an earlier first-match position higher', () => {
            const early = fuzzyScore('ce', 'claude-extra')!;
            const late = fuzzyScore('ce', 'xx-claude-extra')!;
            expect(early).toBeGreaterThan(late);
        });

        it('outranks a multiset (tier 3) match', () => {
            const subsequence = fuzzyScore('clu', 'claude')!;  // tier 2 (in order)
            const multiset = fuzzyScore('ulc', 'claude')!;     // tier 3 (out of order)
            expect(subsequence).toBeGreaterThan(multiset);
        });
    });

    describe('tier 3 — unordered multiset', () => {
        it('matches when all chars are present out of order', () => {
            expect(fuzzyScore('gml', 'glm')).not.toBeNull();
        });

        it('ranks shorter targets higher (within tier 3)', () => {
            // Both targets match 'cba' only as an unordered multiset — there is
            // no ordered c→b→a subsequence in either.
            const short = fuzzyScore('cba', 'abc')!;
            const long = fuzzyScore('cba', 'aabbcc')!;
            expect(short).toBeGreaterThan(long);
        });

        it('respects char multiplicity (gg needs two g)', () => {
            expect(fuzzyScore('gg', 'gamma')).toBeNull();      // single g
            expect(fuzzyScore('gg', 'gg-double')).not.toBeNull();
        });
    });

    it('returns null when a query char is absent from the target', () => {
        expect(fuzzyScore('z', 'claude')).toBeNull();
        expect(fuzzyScore('xyz', 'claude')).toBeNull();
    });
});
