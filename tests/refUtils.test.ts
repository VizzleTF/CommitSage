import { describe, it, expect } from 'vitest';
import { applyRef, extractRef, DEFAULT_BRANCH_PATTERN } from '../src/utils/refUtils';

describe('extractRef', () => {
    it('pulls a Jira/Linear-style ID from a branch with the default pattern', () => {
        expect(extractRef('feature/PROJ-123-login', DEFAULT_BRANCH_PATTERN)).toBe('PROJ-123');
    });

    it('returns null when nothing matches', () => {
        expect(extractRef('main', DEFAULT_BRANCH_PATTERN)).toBeNull();
    });

    it('returns null for an empty branch name', () => {
        expect(extractRef('', DEFAULT_BRANCH_PATTERN)).toBeNull();
    });

    it('uses the first capture group when the pattern has one', () => {
        expect(extractRef('issue-456-fix', '(?:issue|gh)-?([0-9]+)')).toBe('456');
    });

    it('matches plain issue numbers with a custom pattern', () => {
        expect(extractRef('123-quick-fix', '[0-9]+')).toBe('123');
    });

    it('falls back to the default pattern when the regex is invalid', () => {
        expect(extractRef('feature/PROJ-9-x', '([')).toBe('PROJ-9');
    });
});

describe('applyRef', () => {
    it('puts the ref before the subject on the same line for "prefix"', () => {
        expect(applyRef('feat: x\n\nbody', 'PROJ-1', 'prefix')).toBe('PROJ-1 feat: x\n\nbody');
    });

    it('puts the ref on its own line above for "start"', () => {
        expect(applyRef('feat: x', '#12', 'start')).toBe('#12\n\nfeat: x');
    });

    it('puts the ref on its own line below for "end" and unknown values', () => {
        expect(applyRef('feat: x', '#12', 'end')).toBe('feat: x\n\n#12');
        expect(applyRef('feat: x', '#12', 'bogus')).toBe('feat: x\n\n#12');
    });

    it('leaves the message alone when there is no ref', () => {
        expect(applyRef('feat: x', '', 'prefix')).toBe('feat: x');
    });
});
