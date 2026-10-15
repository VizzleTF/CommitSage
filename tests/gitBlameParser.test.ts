import { describe, it, expect } from 'vitest';
import {
    parseOldLineRanges,
    parseBlameAuthors,
    formatBlameSummary,
} from '../src/services/gitBlameParser';

describe('parseOldLineRanges', () => {
    it('returns no ranges for an empty diff', () => {
        expect(parseOldLineRanges('')).toEqual([]);
    });

    it('reads the old side of each hunk, defaulting the count to 1', () => {
        const diff = [
            '@@ -2 +3 @@ one',
            '-two',
            '+TWO',
            '@@ -10,3 +11,1 @@',
            '-a',
            '-b',
            '-c',
            '+abc',
        ].join('\n');
        expect(parseOldLineRanges(diff)).toEqual(['2,2', '10,12']);
    });

    it('skips pure additions, which have no old lines', () => {
        expect(parseOldLineRanges('@@ -0,0 +1 @@\n+zero\n@@ -5,0 +7 @@ five\n+six')).toEqual([]);
    });

    it('ignores the file headers', () => {
        const diff = '--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-x\n+y';
        expect(parseOldLineRanges(diff)).toEqual(['1,1']);
    });
});

describe('parseBlameAuthors', () => {
    const entry = (sha: string, author: string, content: string) => [
        `${sha} 1 1 1`,
        `author ${author}`,
        `author-mail <${author.toLowerCase()}@example.com>`,
        'author-time 1700000000',
        'author-tz +0000',
        'summary init',
        'filename f.ts',
        `\t${content}`,
    ].join('\n');

    it('returns one author per blamed line', () => {
        const porcelain = [
            entry('a'.repeat(40), 'Alice', 'one'),
            entry('b'.repeat(40), 'Bob', ''), // blank file line still counts
            entry('a'.repeat(40), 'Alice', 'author Mallory'), // content is not a header
        ].join('\n');
        expect(parseBlameAuthors(porcelain)).toEqual(['Alice', 'Bob', 'Alice']);
    });

    it('does not count an entry cut off before its content line', () => {
        const cut = entry('a'.repeat(40), 'Alice', 'x') + '\n' + `${'b'.repeat(40)} 2 2 1\nauthor Bob`;
        expect(parseBlameAuthors(cut)).toEqual(['Alice']);
    });
});

describe('formatBlameSummary', () => {
    it('returns empty for no blamed lines', () => {
        expect(formatBlameSummary('a.ts', [])).toBe('');
    });

    it('ranks authors by line count without listing line numbers', () => {
        expect(formatBlameSummary('src/a.ts', ['Bob', 'Alice', 'Alice', 'Bob', 'Alice']))
            .toBe('src/a.ts: modifies lines last changed by Alice (3), Bob (2)');
    });
});
