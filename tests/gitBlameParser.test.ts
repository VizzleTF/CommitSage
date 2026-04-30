import { describe, it, expect } from 'vitest';
import {
    parseBlameOutput,
    parseChangedLines,
    analyzeBlameInfo,
    formatAnalysis,
    BlameInfo,
} from '../src/services/gitBlameParser';

describe('parseBlameOutput', () => {
    it('parses a single blame entry', () => {
        const blame = [
            '0000000000000000000000000000000000000000 1 1 1',
            'author Alice',
            'author-mail <alice@example.com>',
            'author-time 1700000000',
            'author-tz +0000',
            'summary initial',
            'filename foo.ts',
            '\tconst foo = 1;',
        ].join('\n');

        const result = parseBlameOutput(blame);
        expect(result).toHaveLength(1);
        expect(result[0].author).toBe('Alice');
        expect(result[0].email).toBe('alice@example.com');
        expect(result[0].timestamp).toBe(1700000000);
        expect(result[0].line).toBe('const foo = 1;');
        expect(result[0].commit).toBe(
            '0000000000000000000000000000000000000000'
        );
    });

    it('parses multiple blame entries', () => {
        const blame = [
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
            'author Alice',
            'author-mail <alice@example.com>',
            'author-time 1700000000',
            'author-tz +0000',
            'summary one',
            'filename foo.ts',
            '\tline one',
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1',
            'author Bob',
            'author-mail <bob@example.com>',
            'author-time 1700000100',
            'author-tz +0000',
            'summary two',
            'filename foo.ts',
            '\tline two',
        ].join('\n');

        const result = parseBlameOutput(blame);
        expect(result).toHaveLength(2);
        expect(result[0].author).toBe('Alice');
        expect(result[1].author).toBe('Bob');
    });

    it('skips entries missing required fields', () => {
        // Missing author-mail
        const blame = [
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
            'author Alice',
            'author-time 1700000000',
            '\tline one',
        ].join('\n');

        expect(parseBlameOutput(blame)).toHaveLength(0);
    });
});

describe('parseChangedLines', () => {
    it('returns empty set when no hunks', () => {
        expect(parseChangedLines('').size).toBe(0);
    });

    it('captures added lines from a single hunk', () => {
        const diff = [
            '@@ -1,3 +1,4 @@',
            ' const a = 1;',
            '+const b = 2;',
            ' const c = 3;',
            ' const d = 4;',
        ].join('\n');

        const lines = parseChangedLines(diff);
        expect(Array.from(lines).sort((a, b) => a - b)).toEqual([2]);
    });

    it('captures added lines across multiple hunks', () => {
        const diff = [
            '@@ -1,2 +1,3 @@',
            ' a',
            '+b',
            ' c',
            '@@ -10,2 +11,3 @@',
            ' x',
            '+y',
            ' z',
        ].join('\n');

        const lines = parseChangedLines(diff);
        expect(Array.from(lines).sort((a, b) => a - b)).toEqual([2, 12]);
    });

    it('does not advance line counter for removed lines', () => {
        const diff = [
            '@@ -1,3 +1,2 @@',
            ' a',
            '-b',
            ' c',
        ].join('\n');

        // Only context lines exist; no '+' lines, so changedLines stays empty
        expect(parseChangedLines(diff).size).toBe(0);
    });

    it('ignores +++ filename headers', () => {
        const diff = [
            '+++ b/foo.ts',
            '@@ -1,1 +1,2 @@',
            ' a',
            '+b',
        ].join('\n');

        const lines = parseChangedLines(diff);
        expect(Array.from(lines)).toEqual([2]);
    });
});

describe('analyzeBlameInfo', () => {
    const blame: BlameInfo[] = [
        {
            commit: 'a',
            author: 'Alice',
            email: 'alice@example.com',
            date: '2023-01-01',
            timestamp: 1,
            line: 'a',
        },
        {
            commit: 'b',
            author: 'Bob',
            email: 'bob@example.com',
            date: '2023-01-02',
            timestamp: 2,
            line: 'b',
        },
        {
            commit: 'c',
            author: 'Alice',
            email: 'alice@example.com',
            date: '2023-01-03',
            timestamp: 3,
            line: 'c',
        },
    ];

    it('counts changes per author', () => {
        const result = analyzeBlameInfo(blame, new Set([1, 3]));
        const alice = result.get('Alice <alice@example.com>');
        expect(alice?.count).toBe(2);
        expect(alice?.lines).toEqual([1, 3]);
        expect(result.has('Bob <bob@example.com>')).toBe(false);
    });

    it('returns empty map when no changed lines match', () => {
        expect(analyzeBlameInfo(blame, new Set([99])).size).toBe(0);
    });
});

describe('formatAnalysis', () => {
    it('returns "No changes detected." for empty map', () => {
        expect(formatAnalysis(new Map())).toBe('No changes detected.');
    });

    it('formats single line vs plural', () => {
        const map = new Map([
            ['Alice <a@e.com>', { count: 1, lines: [1] }],
            ['Bob <b@e.com>', { count: 2, lines: [2, 3] }],
        ]);
        const out = formatAnalysis(map);
        // Bob comes first (higher count)
        expect(out.startsWith('Bob <b@e.com> modified 2 lines (2, 3)')).toBe(true);
        expect(out).toContain('Alice <a@e.com> modified 1 line (1)');
    });
});
