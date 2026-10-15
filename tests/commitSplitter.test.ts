import { describe, it, expect } from 'vitest';
import { generateSplitPrompt, parseSplitPlan } from '../src/services/commitSplitter';

const paths = ['src/a.ts', 'tests/a.test.ts', 'README.md'];

describe('parseSplitPlan', () => {
    it('groups files by commit number in number order', () => {
        const reply = '2 README.md\n1 src/a.ts\n1 tests/a.test.ts';
        expect(parseSplitPlan(reply, paths)).toEqual({ groups: [['src/a.ts', 'tests/a.test.ts'], ['README.md']] });
    });

    it('tolerates prose, list markers and quoted paths', () => {
        const reply = 'Here is the plan:\nCommit 1: `src/a.ts`\n1. tests/a.test.ts\n2) "README.md"';
        expect(parseSplitPlan(reply, paths)).toEqual({ groups: [['src/a.ts', 'tests/a.test.ts'], ['README.md']] });
    });

    it('reports missing, unknown and repeated paths', () => {
        const reply = '1 src/a.ts\n2 src/a.ts\n1 src/other.ts';
        expect(parseSplitPlan(reply, paths)).toEqual({
            missing: ['tests/a.test.ts', 'README.md'],
            unknown: ['src/a.ts', 'src/other.ts'],
        });
    });
});

describe('generateSplitPrompt', () => {
    it('lists the files and wraps the diff as data', () => {
        const out = generateSplitPrompt(paths, 'DIFF');
        expect(out).toContain('Files:\nsrc/a.ts\ntests/a.test.ts\nREADME.md');
        expect(out).toContain('<diff>\nDIFF\n</diff>');
    });
});
