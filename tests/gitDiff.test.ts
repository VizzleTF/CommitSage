import { describe, it, expect, afterEach, vi } from 'vitest';
import { GitService } from '../src/services/gitService';
import { NoChangesDetectedError } from '../src/models/errors';

const REPO = '/repo';

/**
 * Stub for {@link GitService.execGit}. All of GitService's git operations funnel
 * through `execGit`, so routing on the argv lets us drive `getDiff`'s
 * detectChanges/collectDiffs branches with controlled `git status`/`git diff`
 * output without ever spawning a real `git` process.
 *
 * `handler` maps the joined argv to the stdout string git would produce. A
 * missing key resolves to empty stdout (the common "no such change" case).
 */
type ExecResult = { stdout: string; stderr: string; exitCode: number };

let execGitSpy: ReturnType<typeof vi.spyOn> | undefined;

function installExecGit(handler: (args: string[]) => string | undefined): void {
    execGitSpy = vi.spyOn(
        GitService as unknown as {
            execGit: (args: string[], cwd: string, options?: unknown) => Promise<ExecResult>;
        },
        'execGit',
    ).mockImplementation(async (args: string[]): Promise<ExecResult> => {
        const stdout = handler(args) ?? '';
        return { stdout, stderr: '', exitCode: 0 };
    });
}

// Restore only our own spy. A global vi.restoreAllMocks() would clobber
// module-level spies/mocks installed by other test files when execution
// order interleaves them, causing cross-file flakiness.
afterEach(() => {
    execGitSpy?.mockRestore();
    execGitSpy = undefined;
});

describe('GitService.getDiff (detectChanges / collectDiffs)', () => {
    it('staged-only: returns the staged diff with the staged header', async () => {
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef';
                case 'diff --cached --name-only':
                    return 'a.txt\n';
                // unstaged / untracked / deleted detection -> empty
                case 'diff --name-only':
                    return '';
                case 'ls-files --others --exclude-standard':
                    return '';
                case 'ls-files --deleted':
                    return '';
                case 'ls-files --stage -- a.txt':
                    return '100644 hash 0\ta.txt'; // not a submodule
                case 'diff --cached -- a.txt':
                    return 'diff --git a/a.txt b/a.txt\n+staged line';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, false);
        expect(diff).toContain('# Staged changes:');
        expect(diff).toContain('+staged line');
        expect(diff).not.toContain('# Unstaged changes:');
        expect(diff).not.toContain('# New files:');
        expect(diff).not.toContain('# Deleted files:');
    });

    it('unstaged-only: returns the unstaged diff with the unstaged header', async () => {
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef';
                case 'diff --cached --name-only':
                    return '';
                case 'diff --name-only':
                    return 'b.txt\n';
                case 'ls-files --others --exclude-standard':
                    return '';
                case 'ls-files --deleted':
                    return '';
                case 'ls-files --stage -- b.txt':
                    return '100644 hash 0\tb.txt';
                case 'diff -- b.txt':
                    return 'diff --git a/b.txt b/b.txt\n+unstaged line';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, false);
        expect(diff).toContain('# Unstaged changes:');
        expect(diff).toContain('+unstaged line');
        expect(diff).not.toContain('# Staged changes:');
    });

    it('untracked: returns new-files diff via git diff --no-index', async () => {
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef';
                case 'diff --cached --name-only':
                    return '';
                case 'diff --name-only':
                    return '';
                case 'ls-files --others --exclude-standard':
                    return 'new.txt\n';
                case 'ls-files --deleted':
                    return '';
                case 'diff --no-index -- /dev/null new.txt':
                    return 'diff --git a/new.txt b/new.txt\n+brand new';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, false);
        expect(diff).toContain('# New files:');
        expect(diff).toContain('+brand new');
    });

    it('deleted: returns deleted-files diff', async () => {
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef'; // hasHead -> true, enables deleted detection
                case 'diff --cached --name-only':
                    return '';
                case 'diff --name-only':
                    return '';
                case 'ls-files --others --exclude-standard':
                    return '';
                case 'ls-files --deleted':
                    return 'gone.txt\n';
                case 'diff -- gone.txt':
                    return 'diff --git a/gone.txt b/gone.txt\n-old content';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, false);
        expect(diff).toContain('# Deleted files:');
        expect(diff).toContain('-old content');
    });

    it('mixed: staged + unstaged combine in order with both headers', async () => {
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef';
                case 'diff --cached --name-only':
                    return 's.txt\n';
                case 'diff --name-only':
                    return 'u.txt\n';
                // untracked/deleted suppressed because hasStagedChanges is true
                case 'ls-files --others --exclude-standard':
                    return 'ignored.txt\n';
                case 'ls-files --deleted':
                    return 'ignored-del.txt\n';
                case 'ls-files --stage -- s.txt':
                    return '100644 h 0\ts.txt';
                case 'ls-files --stage -- u.txt':
                    return '100644 h 0\tu.txt';
                case 'diff --cached -- s.txt':
                    return 'STAGED-DIFF';
                case 'diff -- u.txt':
                    return 'UNSTAGED-DIFF';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, false);
        expect(diff).toContain('# Staged changes:');
        expect(diff).toContain('STAGED-DIFF');
        expect(diff).toContain('# Unstaged changes:');
        expect(diff).toContain('UNSTAGED-DIFF');
        // Staged section precedes unstaged section.
        expect(diff.indexOf('# Staged changes:')).toBeLessThan(
            diff.indexOf('# Unstaged changes:'),
        );
        // With staged changes present, untracked/deleted detection is skipped.
        expect(diff).not.toContain('# New files:');
        expect(diff).not.toContain('# Deleted files:');
    });

    it('onlyStagedChanges option: returns only the staged diff without the header', async () => {
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef';
                case 'diff --cached --name-only':
                    return 'only.txt\n';
                case 'ls-files --stage -- only.txt':
                    return '100644 h 0\tonly.txt';
                case 'diff --cached -- only.txt':
                    return 'ONLY-STAGED-DIFF';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, true);
        expect(diff).toBe('ONLY-STAGED-DIFF');
        // onlyStagedChanges path uses getStagedDiff without the "# Staged changes:" prefix.
        expect(diff).not.toContain('# Staged changes:');
    });

    it('honors knownHasStagedChanges=true even when no detection command runs', async () => {
        // knownHasStagedChanges short-circuits the `hasChanges(_, 'staged')`
        // detection in detectChanges. We assert the onlyStagedChanges output
        // path still produces the staged diff. (The file-listing inside
        // getStagedDiff reuses `diff --cached --name-only`, so detection and
        // listing share a command and cannot be told apart by call inspection.)
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef';
                case 'diff --cached --name-only':
                    return 'k.txt\n';
                case 'ls-files --stage -- k.txt':
                    return '100644 h 0\tk.txt';
                case 'diff --cached -- k.txt':
                    return 'KNOWN-STAGED';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, true, true);
        expect(diff).toBe('KNOWN-STAGED');
    });

    it('knownHasStagedChanges=false (full path) skips the staged section', async () => {
        // With onlyStagedChanges=false and knownHasStagedChanges=false, the
        // staged branch of collectDiffs is not taken; only unstaged surfaces.
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef';
                case 'diff --name-only':
                    return 'uns.txt\n';
                case 'ls-files --stage -- uns.txt':
                    return '100644 h 0\tuns.txt';
                case 'diff -- uns.txt':
                    return 'UNSTAGED-ONLY';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, false, false);
        expect(diff).toContain('# Unstaged changes:');
        expect(diff).toContain('UNSTAGED-ONLY');
        expect(diff).not.toContain('# Staged changes:');
    });

    it('no-changes: throws NoChangesDetectedError when nothing is detected', async () => {
        installExecGit((args) => {
            if (args.join(' ') === 'rev-parse HEAD') {
                return 'deadbeef';
            }
            return ''; // every detection command reports no changes
        });

        await expect(GitService.getDiff(REPO, false)).rejects.toBeInstanceOf(
            NoChangesDetectedError,
        );
    });

    it('changes detected but every collected diff is blank: throws NoChangesDetectedError', async () => {
        // hasChanges('unstaged') sees a file (name-only lists it), so detection
        // reports a change, but the per-file diff is empty -> collectDiffs yields
        // nothing -> combinedDiff is '' -> the secondary guard throws.
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return 'deadbeef';
                case 'diff --name-only':
                    return 'phantom.txt\n';
                case 'ls-files --stage -- phantom.txt':
                    return '100644 h 0\tphantom.txt';
                case 'diff -- phantom.txt':
                    return ''; // empty per-file diff
                default:
                    return '';
            }
        });

        await expect(GitService.getDiff(REPO, false)).rejects.toBeInstanceOf(
            NoChangesDetectedError,
        );
    });

    it('wraps unexpected git failures with the "Failed to get diff" prefix', async () => {
        // A non-NoChangesDetectedError thrown from deep in the flow must be
        // re-thrown with the prefix while keeping its constructor/stack.
        // Detection succeeds (staged file listed), but the per-file diff call
        // — which is NOT swallowed by hasChanges/hasHead/isSubmodule — throws.
        execGitSpy = vi.spyOn(
            GitService as unknown as {
                execGit: (a: string[], c: string, o?: unknown) => Promise<ExecResult>;
            },
            'execGit',
        ).mockImplementation(async (args: string[]): Promise<ExecResult> => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    return { stdout: 'deadbeef', stderr: '', exitCode: 0 };
                case 'diff --cached --name-only':
                    return { stdout: 'x.txt\n', stderr: '', exitCode: 0 };
                case 'ls-files --stage -- x.txt':
                    return { stdout: '100644 h 0\tx.txt', stderr: '', exitCode: 0 };
                case 'diff --cached -- x.txt':
                    throw new TypeError('boom');
                default:
                    return { stdout: '', stderr: '', exitCode: 0 };
            }
        });

        await expect(GitService.getDiff(REPO, true)).rejects.toMatchObject({
            name: 'TypeError',
            message: expect.stringContaining('Failed to get diff:'),
        });
    });

    it('no HEAD: deleted detection is skipped, untracked still surfaces', async () => {
        installExecGit((args) => {
            const key = args.join(' ');
            switch (key) {
                case 'rev-parse HEAD':
                    // No reachable response -> hasHead() catches and returns false.
                    throw new Error('fatal: bad revision HEAD');
                case 'diff --cached --name-only':
                    return '';
                case 'diff --name-only':
                    return '';
                case 'ls-files --others --exclude-standard':
                    return 'fresh.txt\n';
                // ls-files --deleted must never be consulted (hasDeletedFiles gated on hasHead).
                case 'diff --no-index -- /dev/null fresh.txt':
                    return 'diff --git a/fresh.txt b/fresh.txt\n+fresh';
                default:
                    return '';
            }
        });

        const diff = await GitService.getDiff(REPO, false);
        expect(diff).toContain('# New files:');
        expect(diff).toContain('+fresh');
        expect(diff).not.toContain('# Deleted files:');
    });
});
