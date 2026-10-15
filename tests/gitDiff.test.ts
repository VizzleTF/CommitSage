import { describe, it, expect, afterEach, vi } from 'vitest';
import { GitService } from '../src/services/gitService';
import { NoChangesDetectedError } from '../src/models/errors';
import { ConfigService } from '../src/utils/configService';

const REPO = '/repo';

/**
 * Stub for {@link GitService.execGit}. All of GitService's git operations funnel
 * through `execGit`, so routing on the argv lets us drive `getDiff` with
 * controlled `git diff` / `git ls-files` output without ever spawning a real
 * `git` process.
 *
 * `handler` maps the argv to the stdout string git would produce (or a full
 * result). A missing key resolves to empty stdout (the "no such change" case).
 */
type ExecResult = { stdout: string; stderr: string; exitCode: number };

let execGitSpy: ReturnType<typeof vi.spyOn> | undefined;
const calls: { args: string[]; options: unknown }[] = [];

function installExecGit(handler: (key: string) => string | ExecResult | undefined): void {
    calls.length = 0;
    execGitSpy = vi.spyOn(
        GitService as unknown as {
            execGit: (args: string[], cwd: string, options?: unknown) => Promise<ExecResult>;
        },
        'execGit',
    ).mockImplementation(async (args: string[], _cwd: string, options?: unknown): Promise<ExecResult> => {
        calls.push({ args, options });
        const out = handler(args.join(' '));
        return typeof out === 'object' ? out : { stdout: out ?? '', stderr: '', exitCode: 0 };
    });
}

// Restore only our own spy. A global vi.restoreAllMocks() would clobber
// module-level spies/mocks installed by other test files when execution
// order interleaves them, causing cross-file flakiness.
let configSpy: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => {
    execGitSpy?.mockRestore();
    execGitSpy = undefined;
    configSpy?.mockRestore();
    configSpy = undefined;
});

describe('GitService.getDiff staged mode', () => {
    it('returns the per-file staged diffs without a header and ignores the worktree', async () => {
        installExecGit((key) => ({
            'diff --cached --name-only -z': 'a.txt\0img_160000.png\0',
            '--literal-pathspecs diff --cached --no-color --no-ext-diff --ignore-submodules=dirty -- a.txt': 'diff --git a/a.txt b/a.txt\n+staged line\n',
            // A real file whose name contains a gitlink mode is not a submodule.
            '--literal-pathspecs diff --cached --no-color --no-ext-diff --ignore-submodules=dirty -- img_160000.png': 'diff --git a/img_160000.png b/img_160000.png\nBinary\n',
        } as Record<string, string>)[key]);

        const diff = await GitService.getDiff(REPO, true);

        expect(diff).toContain('+staged line');
        expect(diff).toContain('img_160000.png');
        expect(diff).not.toContain('#');
        expect(calls.some((c) => c.args[0] === 'ls-files')).toBe(false);
        expect(calls.some((c) => c.args.join(' ') === 'diff --name-only -z')).toBe(false);
    });

    it('throws a staged-specific NoChangesDetectedError when the index is empty', async () => {
        installExecGit(() => '');
        await expect(GitService.getDiff(REPO, true)).rejects.toMatchObject({
            name: 'NoChangesDetectedError',
            message: expect.stringContaining('No staged changes'),
        });
    });

    it('throws NoChangesDetectedError when every staged diff is blank', async () => {
        installExecGit((key) => (key === 'diff --cached --name-only -z' ? 'sub\0' : ''));
        await expect(GitService.getDiff(REPO, true)).rejects.toBeInstanceOf(NoChangesDetectedError);
    });

    it('diffs a renamed file as a rename pair instead of a new file', async () => {
        installExecGit((key) => ({
            'diff --cached --name-only -z': 'new.txt\0',
            'diff --cached --name-status -M -z': 'R100\0old.txt\0new.txt\0',
            '--literal-pathspecs diff --cached --no-color --no-ext-diff --ignore-submodules=dirty -M -- old.txt new.txt':
                'diff --git a/old.txt b/new.txt\nrename from old.txt\nrename to new.txt',
        } as Record<string, string>)[key]);

        const diff = await GitService.getDiff(REPO, true);

        expect(diff).toContain('rename from old.txt');
        // The single-pathspec form would have shown the whole file as new.
        expect(calls.some((c) => c.args.join(' ').endsWith('-- new.txt'))).toBe(false);
    });

    it('falls back to the plain per-file diff when the rename probe fails', async () => {
        installExecGit((key) => {
            if (key === 'diff --cached --name-status -M -z') {
                throw new Error('git exploded');
            }
            return ({
                'diff --cached --name-only -z': 'a.txt\0',
                '--literal-pathspecs diff --cached --no-color --no-ext-diff --ignore-submodules=dirty -- a.txt': 'diff --git a/a.txt b/a.txt\n+line',
            } as Record<string, string>)[key];
        });

        await expect(GitService.getDiff(REPO, true)).resolves.toContain('+line');
    });
});

describe('GitService.getDiff worktree mode', () => {
    it('puts tracked edits under one header and untracked files under another', async () => {
        installExecGit((key) => ({
            // A worktree deletion is listed here once — there is no separate
            // deleted-files pass that would diff it a second time.
            'diff --name-only -z': 'b.txt\0gone.txt\0',
            'ls-files --others --exclude-standard -z': 'new file ü.txt\0',
            '--literal-pathspecs diff --no-color --no-ext-diff --ignore-submodules=dirty -- b.txt': 'diff --git a/b.txt b/b.txt\n+unstaged line\n',
            '--literal-pathspecs diff --no-color --no-ext-diff --ignore-submodules=dirty -- gone.txt': 'diff --git a/gone.txt b/gone.txt\n-old content\n',
            // -z listings pass paths with spaces/Unicode through unquoted.
            'diff --no-color --no-ext-diff --no-index -- /dev/null new file ü.txt': { stdout: '+brand new\n', stderr: '', exitCode: 1 },
        } as Record<string, string | ExecResult>)[key]);

        const diff = await GitService.getDiff(REPO, false);

        expect(diff.match(/# Unstaged changes:/g)).toHaveLength(1);
        expect(diff.match(/-old content/g)).toHaveLength(1);
        expect(diff).toContain('+unstaged line');
        expect(diff.indexOf('# Unstaged changes:')).toBeLessThan(diff.indexOf('# New files:'));
        expect(diff).toContain('+brand new');
        expect(calls.some((c) => c.args.includes('--deleted'))).toBe(false);
    });

    it('drops untracked diffs that fail (exit 128 or a thrown error)', async () => {
        installExecGit((key) => {
            if (key === 'diff --no-color --no-ext-diff --no-index -- /dev/null throws.txt') {
                throw new Error('diff boom');
            }
            return ({
                'ls-files --others --exclude-standard -z': 'good.txt\0blocked.txt\0throws.txt\0',
                'diff --no-color --no-ext-diff --no-index -- /dev/null good.txt': { stdout: '+good', stderr: '', exitCode: 1 },
                'diff --no-color --no-ext-diff --no-index -- /dev/null blocked.txt': { stdout: 'should be dropped', stderr: '', exitCode: 128 },
            } as Record<string, string | ExecResult>)[key];
        });

        const diff = await GitService.getDiff(REPO, false);

        expect(diff).toBe('# New files:\n+good');
    });

    it('throws NoChangesDetectedError when nothing changed', async () => {
        installExecGit(() => '');
        await expect(GitService.getDiff(REPO, false)).rejects.toBeInstanceOf(NoChangesDetectedError);
    });
});

describe('GitService.getDiff output caps', () => {
    it('raises the per-file buffer to general.maxDiffSize', async () => {
        configSpy = vi.spyOn(ConfigService, 'get').mockImplementation(((key: string) =>
            key === 'general.maxDiffSize' ? 1_000_000 : undefined) as never);
        installExecGit((key) => ({
            'diff --name-only -z': 'big.txt\0',
            '--literal-pathspecs diff --no-color --no-ext-diff --ignore-submodules=dirty -- big.txt': 'diff --git a/big.txt b/big.txt\n+x',
        } as Record<string, string>)[key]);

        await GitService.getDiff(REPO, false);

        const fileDiff = calls.find((c) => c.args.includes('big.txt'));
        expect(fileDiff?.options).toMatchObject({ maxBuffer: 1_000_000 });
    });

    it('caps the per-file buffer at 1M chars when truncation is off (-1)', async () => {
        configSpy = vi.spyOn(ConfigService, 'get').mockImplementation(((key: string) =>
            key === 'general.maxDiffSize' ? -1 : undefined) as never);
        installExecGit((key) => (key === 'diff --name-only -z' ? 'big.txt\0' : ''));

        await expect(GitService.getDiff(REPO, false)).rejects.toBeInstanceOf(NoChangesDetectedError);

        const fileDiff = calls.find((c) => c.args.includes('big.txt'));
        expect(fileDiff?.options).toMatchObject({ maxBuffer: 1_000_000 });
    });

    it('fails instead of using a file listing cut at the output cap', async () => {
        installExecGit((key) => (key === 'diff --name-only -z'
            ? { stdout: 'a.txt\0half/pa', stderr: '', exitCode: -1 }
            : ''));

        await expect(GitService.getDiff(REPO, false)).rejects.toThrow(/Failed to get diff: .*too large/);
    });

    it('wraps unexpected git failures with the "Failed to get diff" prefix', async () => {
        // The per-file diff is not swallowed, so its error surfaces with the
        // prefix while keeping its name and stack.
        installExecGit((key) => {
            if (key === '--literal-pathspecs diff --cached --no-color --no-ext-diff --ignore-submodules=dirty -- x.txt') {
                throw new TypeError('boom');
            }
            return key === 'diff --cached --name-only -z' ? 'x.txt\0' : '';
        });

        await expect(GitService.getDiff(REPO, true)).rejects.toMatchObject({
            name: 'TypeError',
            message: expect.stringContaining('Failed to get diff:'),
        });
    });
});
