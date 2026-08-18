import { describe, it, expect } from 'vitest';
import { unquoteGitPath } from '../src/utils/gitPath';

describe('unquoteGitPath', () => {
    it('returns ASCII path unchanged when not quoted', () => {
        expect(unquoteGitPath('src/file.ts')).toBe('src/file.ts');
    });

    it('strips surrounding double quotes', () => {
        expect(unquoteGitPath('"path with space.ts"')).toBe('path with space.ts');
    });

    it('decodes octal-escaped UTF-8 sequences (Cyrillic)', () => {
        // "файл.ts" — 6-byte UTF-8 file name in octal escapes
        const input =
            '"\\321\\204\\320\\260\\320\\271\\320\\273.ts"';
        expect(unquoteGitPath(input)).toBe('файл.ts');
    });

    it('decodes octal-escaped UTF-8 sequences (emoji)', () => {
        // ⚡ encoded as \342\232\241
        expect(unquoteGitPath('"\\342\\232\\241.ts"')).toBe('⚡.ts');
    });

    it('unescapes backslash-escaped quote', () => {
        expect(unquoteGitPath('"a\\"b.ts"')).toBe('a"b.ts');
    });

    it('unescapes double backslash', () => {
        expect(unquoteGitPath('"a\\\\b.ts"')).toBe('a\\b.ts');
    });

    it('decodes C escapes for tab, newline and carriage return (B9)', () => {
        expect(unquoteGitPath(String.raw`"a\tb.ts"`)).toBe('a\tb.ts');
        expect(unquoteGitPath(String.raw`"a\nb.ts"`)).toBe('a\nb.ts');
        expect(unquoteGitPath(String.raw`"a\rb.ts"`)).toBe('a\rb.ts');
    });

    it('keeps a literal backslash followed by t as two characters', () => {
        // git quotes the backslash itself, so `\\t` is `\` + `t`, not a tab.
        expect(unquoteGitPath(String.raw`"a\\tb.ts"`)).toBe(String.raw`a\tb.ts`);
    });

    it('does not unquote unbalanced quotes', () => {
        expect(unquoteGitPath('"foo')).toBe('"foo');
        expect(unquoteGitPath('foo"')).toBe('foo"');
    });
});
