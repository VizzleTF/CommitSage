import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecGit, mockError, mockLog } = vi.hoisted(() => ({
    mockExecGit: vi.fn(),
    mockError: vi.fn(),
    mockLog: vi.fn(),
}));

vi.mock('../src/services/gitService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/services/gitService')>()),
    GitService: { execGit: mockExecGit },
}));

vi.mock('../src/utils/logger', () => ({
    Logger: { error: mockError, log: mockLog },
}));

import { GitBlameAnalyzer } from '../src/services/gitBlameAnalyzer';

// Captured from a real repo: `git diff HEAD --unified=0 -- a.ts` after
// prepending "zero", editing lines 2 and 4 and appending "six".
const REAL_DIFF = [
    'diff --git a/a.ts b/a.ts',
    'index 1462005..db09d2f 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -0,0 +1 @@',
    '+zero',
    '@@ -2 +3 @@ one',
    '-two',
    '+TWO',
    '@@ -4 +5 @@ three',
    '-FOUR',
    '+4',
    '@@ -5,0 +7 @@ five',
    '+six',
    '',
].join('\n');

// Captured from the same repo: `git blame --line-porcelain -L 2,2 -L 4,4 HEAD -- a.ts`.
const REAL_BLAME = [
    '1efc3b9d1990738d002a543af95f4d126182d936 2 2 1',
    'author Alice',
    'author-mail <a@x>',
    'author-time 1792005901',
    'author-tz +0300',
    'committer Alice',
    'committer-mail <a@x>',
    'committer-time 1792005901',
    'committer-tz +0300',
    'summary init',
    'boundary',
    'filename a.ts',
    '\ttwo',
    '5d7c256c7666002108be02e767333916e933eb60 4 4 1',
    'author Bob',
    'author-mail <b@x>',
    'author-time 1792005901',
    'author-tz +0300',
    'committer Bob',
    'committer-mail <b@x>',
    'committer-time 1792005901',
    'committer-tz +0300',
    'summary bob',
    'previous 3590f89be239ab0f68f70f6c9740761ac73072dc a.ts',
    'filename a.ts',
    '\tFOUR',
    '',
].join('\n');

function routeGit(diff: string, blame: string): void {
    mockExecGit.mockImplementation(async (args: string[]) => ({
        stdout: args.includes('blame') ? blame : diff,
        stderr: '',
        exitCode: 0,
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    routeGit(REAL_DIFF, REAL_BLAME);
});

describe('GitBlameAnalyzer.analyzeChanges', () => {
    it('blames the old side of a real diff against HEAD and summarizes by author', async () => {
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', ' M', false);

        expect(mockExecGit).toHaveBeenCalledWith(
            ['--literal-pathspecs', 'diff', 'HEAD', '--unified=0', '--no-color', '--no-ext-diff', '--', 'a.ts'],
            '/repo',
            { signal: undefined },
        );
        // Pure additions (zero, six) have no old lines and are not blamed.
        expect(mockExecGit).toHaveBeenCalledWith(
            ['--literal-pathspecs', 'blame', '--line-porcelain', '-L', '2,2', '-L', '4,4', 'HEAD', '--', 'a.ts'],
            '/repo',
            { signal: undefined },
        );
        expect(out).toBe('a.ts: modifies lines last changed by Alice (1), Bob (1)');
        expect(out).not.toContain('Not Committed Yet');
    });

    it('uses the staged (--cached) diff in staged mode', async () => {
        await GitBlameAnalyzer.analyzeChanges('/repo', 'src/a.ts', 'M ', true);
        expect(mockExecGit).toHaveBeenCalledWith(
            ['--literal-pathspecs', 'diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff', '--', 'src/a.ts'],
            '/repo',
            { signal: undefined },
        );
    });

    it('skips blame when the diff only adds lines', async () => {
        routeGit('@@ -0,0 +1,2 @@\n+a\n+b\n', REAL_BLAME);
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', ' M', false);
        expect(out).toBe('');
        expect(mockExecGit).toHaveBeenCalledTimes(1);
    });

    it('returns a deleted-file marker without running git', async () => {
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', '/foo/bar.ts', ' D', false);
        expect(out).toBe('Deleted file: foo/bar.ts');
        expect(mockExecGit).not.toHaveBeenCalled();
    });

    it('returns a new-file marker without running git', async () => {
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', 'new.ts', '??', false);
        expect(out).toBe('New file: new.ts');
        expect(mockExecGit).not.toHaveBeenCalled();
    });

    it('retries blame without a configured ignore-revs file the repo lacks', async () => {
        mockExecGit.mockImplementation(async (args: string[]) => {
            if (args.includes('blame') && !args.includes('--no-ignore-revs-file')) {
                throw new Error('Git command failed with code 128: fatal: could not open object name list: .git-blame-ignore-revs');
            }
            return { stdout: args.includes('blame') ? REAL_BLAME : REAL_DIFF, stderr: '', exitCode: 0 };
        });
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', ' M', false);
        expect(out).toBe('a.ts: modifies lines last changed by Alice (1), Bob (1)');
        expect(mockExecGit).toHaveBeenLastCalledWith(
            ['--literal-pathspecs', 'blame', '--no-ignore-revs-file', '--line-porcelain', '-L', '2,2', '-L', '4,4', 'HEAD', '--', 'a.ts'],
            '/repo',
            { signal: undefined },
        );
    });

    it('logs and degrades to empty when git fails', async () => {
        mockExecGit.mockRejectedValue(new Error('git boom'));
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', ' M', false);
        expect(out).toBe('');
        expect(mockError).toHaveBeenCalledWith('Error analyzing changes:', expect.any(Error));
    });

    it('rethrows (does not swallow) when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        mockExecGit.mockRejectedValue(new Error('aborted'));
        await expect(GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', ' M', false, controller.signal))
            .rejects.toThrow('aborted');
    });

    it('passes a provided AbortSignal through', async () => {
        const signal = new AbortController().signal;
        await GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', ' M', false, signal);
        expect(mockExecGit).toHaveBeenCalledWith(expect.anything(), '/repo', { signal });
    });
});
