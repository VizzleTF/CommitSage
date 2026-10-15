import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// child_process.spawn is mocked so we can drive the execGit() spawn machinery
// (stdout/stderr accumulation, buffer cap, timeout SIGTERM, abort, error,
// non-zero exit) without launching a real process.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { GitService } from '../src/services/gitService';
import { GitRepositoryProvider } from '../src/services/gitRepository';
import {
    GitExtensionNotFoundError,
    NoRepositoriesFoundError,
    NoRepositorySelectedError,
    NoChangesDetectedError,
} from '../src/models/errors';
import * as vscode from 'vscode';
import { ConfigService } from '../src/utils/configService';

type ExecResult = { stdout: string; stderr: string; exitCode: number };

/** Spy execGit and route per joined-argv. Missing key -> empty stdout. */
let execGitSpy: ReturnType<typeof vi.spyOn> | undefined;
function installExecGit(
    handler: (args: string[]) => string | { result: ExecResult } | { throws: Error } | undefined,
): void {
    execGitSpy = vi
        .spyOn(
            GitService as unknown as {
                execGit: (a: string[], c: string, o?: unknown) => Promise<ExecResult>;
            },
            'execGit',
        )
        .mockImplementation(async (args: string[]): Promise<ExecResult> => {
            const out = handler(args);
            if (out && typeof out === 'object' && 'throws' in out) {
                throw out.throws;
            }
            if (out && typeof out === 'object' && 'result' in out) {
                return out.result;
            }
            return { stdout: (out as string) ?? '', stderr: '', exitCode: 0 };
        });
}

/** A fake repository SourceControl. */
function fakeRepo(fsPath?: string): vscode.SourceControl {
    return {
        rootUri: fsPath ? ({ fsPath } as vscode.Uri) : undefined,
    } as unknown as vscode.SourceControl;
}

beforeEach(() => {
    spawnMock.mockReset();
});

afterEach(() => {
    execGitSpy?.mockRestore();
    execGitSpy = undefined;
    vi.restoreAllMocks();
});

describe('GitService.commitChanges', () => {
    it('throws NoChangesDetectedError when nothing is staged', async () => {
        installExecGit(() => '');
        await expect(
            GitService.commitChanges('msg', '/repo', false),
        ).rejects.toBeInstanceOf(NoChangesDetectedError);
    });

    it('commits staged changes without touching the index', async () => {
        const calls: string[][] = [];
        installExecGit((args) => {
            calls.push(args);
            return args.join(' ') === 'diff --cached --name-only -z' ? 'a.txt\0' : '';
        });
        await expect(
            GitService.commitChanges('feat: x', '/repo', false),
        ).resolves.toBeUndefined();
        expect(calls.some((c) => c[0] === 'add')).toBe(false);
        expect(calls.some((c) => c[0] === 'commit' && c[2] === 'feat: x')).toBe(true);
    });

    it('passes --signoff only when asked', async () => {
        const commits: string[][] = [];
        installExecGit((args) => {
            if (args[0] === 'commit') { commits.push(args); }
            return args.join(' ') === 'diff --cached --name-only -z' ? 'a.txt\0' : '';
        });
        await GitService.commitChanges('feat: x', '/repo', false, true);
        await GitService.commitChanges('feat: y', '/repo', false);
        expect(commits).toEqual([['commit', '--signoff', '-m', 'feat: x'], ['commit', '-m', 'feat: y']]);
    });

    it('rethrows and reports commit_failed when the commit command fails', async () => {
        installExecGit((args) => {
            if (args.join(' ') === 'diff --cached --name-only -z') {
                return 'a.txt\0';
            }
            if (args[0] === 'commit') {
                return { throws: new Error('commit failed') };
            }
            return '';
        });
        await expect(
            GitService.commitChanges('m', '/repo', false),
        ).rejects.toThrow('commit failed');
    });

    it('stageAll: stages the whole worktree with `add -A` before committing', async () => {
        const calls: string[][] = [];
        installExecGit((args) => {
            calls.push(args);
            // After `add -A` everything the message was generated from is staged.
            return args.join(' ') === 'diff --cached --name-only -z' ? 'edited.txt\0' : '';
        });

        await GitService.commitChanges('msg', '/repo', true);

        expect(calls[0]).toEqual(['add', '-A']);
        expect(calls.filter((c) => c[0] === 'add')).toEqual([['add', '-A']]);
        expect(calls.some((c) => c[0] === 'commit')).toBe(true);
    });

    it('stageAll: commits even when the staged listing overflows the output cap', async () => {
        const calls: string[][] = [];
        installExecGit((args) => {
            calls.push(args);
            return args.join(' ') === 'diff --cached --name-only -z'
                ? { result: { stdout: 'a.txt\0half/pa', stderr: '', exitCode: -1 } }
                : '';
        });

        await expect(GitService.commitChanges('msg', '/repo', true)).resolves.toBeUndefined();
        expect(calls.some((c) => c[0] === 'commit')).toBe(true);
    });

    it('stageAll: still reports NoChangesDetectedError when `add -A` stages nothing', async () => {
        installExecGit(() => '');
        await expect(
            GitService.commitChanges('msg', '/repo', true),
        ).rejects.toBeInstanceOf(NoChangesDetectedError);
    });
});

describe('GitService.pushChanges', () => {
    it('pushes when a remote is configured', async () => {
        installExecGit((args) => {
            if (args[0] === 'remote') {
                return 'origin\n';
            }
            return '';
        });
        await expect(GitService.pushChanges('/repo')).resolves.toBeUndefined();
    });

    it('throws when the repository has no remotes', async () => {
        installExecGit((args) => {
            if (args[0] === 'remote') {
                return ''; // no remotes
            }
            return '';
        });
        await expect(GitService.pushChanges('/repo')).rejects.toThrow(
            /no configured remotes/i,
        );
    });

    it('treats a remote-listing failure as no remotes', async () => {
        installExecGit((args) => {
            if (args[0] === 'remote') {
                return { throws: new Error('remote boom') };
            }
            return '';
        });
        await expect(GitService.pushChanges('/repo')).rejects.toThrow(
            /no configured remotes/i,
        );
    });

    it('rethrows when the push command fails', async () => {
        installExecGit((args) => {
            if (args[0] === 'remote') {
                return 'origin\n';
            }
            if (args[0] === 'push') {
                return { throws: new Error('push rejected') };
            }
            return '';
        });
        await expect(GitService.pushChanges('/repo')).rejects.toThrow(
            'push rejected',
        );
    });
});

describe('GitService.getChangedFiles', () => {
    it('parses NUL-separated porcelain output into path/status entries', async () => {
        installExecGit((args) => {
            if (args.join(' ') === 'status --porcelain -z') {
                return 'M  staged.txt\0 M with space.txt\0?? ü.txt\0';
            }
            return '';
        });
        const files = await GitService.getChangedFiles('/repo');
        expect(files).toEqual([
            { path: 'staged.txt', status: 'M ' },
            { path: 'with space.txt', status: ' M' },
            { path: 'ü.txt', status: '??' },
        ]);
    });

    it('takes the new path of a rename and skips the old one', async () => {
        installExecGit((args) => {
            if (args.join(' ') === 'status --porcelain -z') {
                return 'RM new.txt\0old.txt\0 M other.txt\0';
            }
            return '';
        });
        expect(await GitService.getChangedFiles('/repo')).toEqual([
            { path: 'new.txt', status: 'RM' },
            { path: 'other.txt', status: ' M' },
        ]);
    });

    it('propagates a status failure instead of reporting no changes', async () => {
        installExecGit(() => ({ throws: new Error('status boom') }));
        await expect(GitService.getChangedFiles('/repo')).rejects.toThrow('status boom');
    });
});

describe('GitService.hasHead', () => {
    it('returns true when rev-parse succeeds', async () => {
        installExecGit(() => 'deadbeef');
        expect(await GitService.hasHead('/repo')).toBe(true);
    });

    it('returns false when rev-parse throws', async () => {
        installExecGit(() => ({ throws: new Error('no head') }));
        expect(await GitService.hasHead('/repo')).toBe(false);
    });
});

describe('GitRepositoryProvider.getRepositories / validateGitExtension', () => {
    it('throws GitExtensionNotFoundError when the git extension is absent', async () => {
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
        await expect(GitRepositoryProvider.getRepositories()).rejects.toBeInstanceOf(
            GitExtensionNotFoundError,
        );
        await expect(GitRepositoryProvider.validateGitExtension()).rejects.toBeInstanceOf(
            GitExtensionNotFoundError,
        );
    });

    it('throws NoRepositoriesFoundError when the API exposes no repositories', async () => {
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate: async () => ({ getAPI: () => ({ repositories: [] }) }),
        } as unknown as vscode.Extension<unknown>);
        await expect(GitRepositoryProvider.getRepositories()).rejects.toBeInstanceOf(
            NoRepositoriesFoundError,
        );
    });

    it('returns the repositories list when present', async () => {
        const repos = [fakeRepo('/r1'), fakeRepo('/r2')];
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate: async () => ({ getAPI: () => ({ repositories: repos }) }),
        } as unknown as vscode.Extension<unknown>);
        expect(await GitRepositoryProvider.getRepositories()).toBe(repos);
    });

    it('validateGitExtension activates the extension when present', async () => {
        const activate = vi.fn(async () => ({}));
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate,
        } as unknown as vscode.Extension<unknown>);
        await GitRepositoryProvider.validateGitExtension();
        expect(activate).toHaveBeenCalled();
    });
});

describe('GitRepositoryProvider.selectRepository', () => {
    it('returns the picked repository', async () => {
        const repo = fakeRepo('/repo');
        vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({
            repository: repo,
        } as never);
        expect(await GitRepositoryProvider.selectRepository([repo])).toBe(repo);
    });

    it('labels repos without a rootUri and throws when the pick is cancelled', async () => {
        const repo = fakeRepo(undefined);
        const showQuickPick = vi
            .spyOn(vscode.window, 'showQuickPick')
            .mockResolvedValue(undefined as never);
        await expect(GitRepositoryProvider.selectRepository([repo])).rejects.toBeInstanceOf(
            NoRepositorySelectedError,
        );
        // The repo without rootUri produced an "Unknown repository" option.
        const options = showQuickPick.mock.calls[0][0] as Array<{ label: string }>;
        expect(options[0].label).toBe('Unknown repository');
    });
});

/**
 * Fake spawn() child. stdout/stderr are EventEmitters with a no-op
 * `setEncoding` (mirroring Readable) so execGit's UTF-8 decode setup works;
 * `close`/`error` are emitted on the child itself. `kill` records the signal
 * and flips `killed`.
 */
class FakeStream extends EventEmitter {
    setEncoding(): this {
        return this;
    }
}
class FakeChild extends EventEmitter {
    stdout = new FakeStream();
    stderr = new FakeStream();
    killed = false;
    // Like a real ChildProcess: both stay null while the process runs.
    exitCode: number | null = null;
    signalCode: string | null = null;
    killSignals: string[] = [];
    kill(signal?: string): boolean {
        this.killSignals.push(signal ?? 'SIGTERM');
        this.killed = true;
        return true;
    }
}

describe('GitService.execGit (spawn machinery)', () => {
    type Opts = { signal?: AbortSignal; allowNonZeroExit?: boolean; maxBuffer?: number };
    const execGit = (args: string[], cwd: string, opts?: Opts) =>
        (
            GitService as unknown as {
                execGit: (a: string[], c: string, o?: Opts) => Promise<ExecResult>;
            }
        ).execGit(args, cwd, opts);

    function nextChild(): FakeChild {
        const child = new FakeChild();
        spawnMock.mockReturnValueOnce(child);
        return child;
    }

    it('resolves with accumulated stdout/stderr on a clean exit (code 0)', async () => {
        const child = nextChild();
        const p = execGit(['status'], '/repo');
        child.stdout.emit('data', Buffer.from('out-'));
        child.stdout.emit('data', Buffer.from('put'));
        child.stderr.emit('data', Buffer.from('warn'));
        child.emit('close', 0, null);
        await expect(p).resolves.toEqual({
            stdout: 'out-put',
            stderr: 'warn',
            exitCode: 0,
        });
    });

    it('rejects on a non-zero exit without allowNonZeroExit', async () => {
        const child = nextChild();
        const p = execGit(['diff'], '/repo');
        child.stderr.emit('data', Buffer.from('fatal: bad'));
        child.emit('close', 2, null);
        await expect(p).rejects.toThrow(/Git command failed with code 2: fatal: bad/);
    });

    it('resolves a non-zero exit when allowNonZeroExit is set', async () => {
        const child = nextChild();
        const p = execGit(['diff', '--no-index'], '/repo', { allowNonZeroExit: true });
        child.stdout.emit('data', Buffer.from('the diff'));
        child.emit('close', 1, null);
        await expect(p).resolves.toEqual({
            stdout: 'the diff',
            stderr: '',
            exitCode: 1,
        });
    });

    it('rejects with a timeout message when closed via SIGTERM (no overflow)', async () => {
        const child = nextChild();
        const p = execGit(['fetch'], '/repo');
        child.emit('close', null, 'SIGTERM');
        await expect(p).rejects.toThrow(/timed out after/);
    });

    it('raises the stdout cap to options.maxBuffer', async () => {
        const child = nextChild();
        const p = execGit(['diff'], '/repo', { maxBuffer: 300_000 });
        child.stdout.emit('data', Buffer.from('x'.repeat(250_000)));
        child.emit('close', 0, null);
        const res = await p;
        expect(res.exitCode).toBe(0);
        expect(res.stdout.length).toBe(250_000);
        expect(child.killSignals).toEqual([]);
    });

    it('truncates and resolves when the stdout buffer cap overflows', async () => {
        const child = nextChild();
        const p = execGit(['show'], '/repo');
        // Exceed GIT_OUTPUT_BUFFER_CAP (200_000) to trigger the overflow kill.
        const big = 'x'.repeat(200_001);
        child.stdout.emit('data', Buffer.from(big));
        // Further data after overflow is ignored.
        child.stdout.emit('data', Buffer.from('ignored'));
        // The overflow path SIGTERMs the child; emulate its close.
        child.emit('close', null, 'SIGTERM');
        const res = await p;
        expect(res.exitCode).toBe(-1);
        expect(res.stdout.length).toBe(200_000);
        expect(child.killSignals).toContain('SIGTERM');
    });

    it('marks an overflowed stdout even when git exits 0 before the SIGTERM lands', async () => {
        const child = nextChild();
        const p = execGit(['status'], '/repo');
        child.stdout.emit('data', Buffer.from('x'.repeat(200_001)));
        child.stdout.emit('data', Buffer.from('dropped'));
        child.emit('close', 0, null);
        const res = await p;
        expect(res.exitCode).toBe(-1);
        expect(res.stdout.length).toBe(200_000);
    });

    it('caps stderr accumulation at the buffer cap', async () => {
        const child = nextChild();
        const p = execGit(['log'], '/repo');
        const bigErr = 'e'.repeat(200_001);
        child.stderr.emit('data', Buffer.from(bigErr));
        child.stderr.emit('data', Buffer.from('more-ignored'));
        child.emit('close', 0, null);
        const res = await p;
        // The first chunk was accepted (length check is "before append"),
        // the second was dropped once over cap.
        expect(res.stderr).toBe(bigErr);
        expect(res.stderr).not.toContain('more-ignored');
    });

    it('rejects with the underlying error on a spawn error event', async () => {
        const child = nextChild();
        const p = execGit(['status'], '/repo');
        child.emit('error', new Error('ENOENT git'));
        await expect(p).rejects.toThrow('ENOENT git');
    });

    it('kills the child and rejects when the signal is already aborted', async () => {
        const child = nextChild();
        const controller = new AbortController();
        controller.abort();
        const p = execGit(['status'], '/repo', { signal: controller.signal });
        // onAbort fired synchronously; the close handler then rejects "cancelled".
        child.emit('close', null, 'SIGTERM');
        await expect(p).rejects.toThrow(/cancelled/i);
        expect(child.killSignals).toContain('SIGTERM');
    });

    it('aborts mid-flight when the signal fires after spawn', async () => {
        const child = nextChild();
        const controller = new AbortController();
        const p = execGit(['status'], '/repo', { signal: controller.signal });
        controller.abort();
        child.emit('close', null, 'SIGTERM');
        await expect(p).rejects.toThrow(/cancelled/i);
    });

    it('hard-kills with SIGKILL if the child survives the grace period', async () => {
        // SIGTERM was sent (`killed` is true) but the process ignores it and
        // never exits, so the 1500ms grace-period timer must escalate.
        const child = new FakeChild();
        spawnMock.mockReturnValueOnce(child);
        vi.useFakeTimers();
        const controller = new AbortController();
        const p = execGit(['status'], '/repo', { signal: controller.signal });
        controller.abort(); // schedules the 1500ms hard-kill timer
        vi.advanceTimersByTime(1600);
        vi.useRealTimers();
        child.emit('close', null, 'SIGKILL');
        await expect(p).rejects.toThrow(/cancelled/i);
        expect(child.killSignals).toContain('SIGKILL');
    });

    it('removes the abort listener on a clean close', async () => {
        const child = nextChild();
        const controller = new AbortController();
        const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
        const p = execGit(['status'], '/repo', { signal: controller.signal });
        child.stdout.emit('data', Buffer.from('ok'));
        child.emit('close', 0, null);
        await expect(p).resolves.toMatchObject({ stdout: 'ok' });
        expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('removes the abort listener on an error event', async () => {
        const child = nextChild();
        const controller = new AbortController();
        const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
        const p = execGit(['status'], '/repo', { signal: controller.signal });
        child.emit('error', new Error('boom'));
        await expect(p).rejects.toThrow('boom');
        expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });
});

describe('GitRepositoryProvider.getActiveRepository', () => {
    it('returns the passed repository when it has a rootUri', async () => {
        const repo = fakeRepo('/repo');
        expect(await GitRepositoryProvider.getActiveRepository(repo)).toBe(repo);
    });

    it('returns the sole repository when only one exists', async () => {
        const repo = fakeRepo('/only');
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate: async () => ({ getAPI: () => ({ repositories: [repo] }) }),
        } as unknown as vscode.Extension<unknown>);
        expect(await GitRepositoryProvider.getActiveRepository()).toBe(repo);
    });

    it('picks the repo owning the active editor file', async () => {
        const r1 = fakeRepo('/repoA');
        const r2 = fakeRepo('/repoB');
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate: async () => ({ getAPI: () => ({ repositories: [r1, r2] }) }),
        } as unknown as vscode.Extension<unknown>);
        (vscode.window as { activeTextEditor: unknown }).activeTextEditor = {
            document: { uri: { fsPath: '/repoB/src/file.ts' } },
        };
        try {
            expect(await GitRepositoryProvider.getActiveRepository()).toBe(r2);
        } finally {
            (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
        }
    });

    it('falls back to selectRepository when no editor repo matches', async () => {
        const r1 = fakeRepo('/repoA');
        const r2 = fakeRepo('/repoB');
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate: async () => ({ getAPI: () => ({ repositories: [r1, r2] }) }),
        } as unknown as vscode.Extension<unknown>);
        // active editor outside any repo, plus a repo with no rootUri to cover
        // the `!repo.rootUri` guard in the finder.
        const r3 = fakeRepo(undefined);
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate: async () => ({
                getAPI: () => ({ repositories: [r1, r2, r3] }),
            }),
        } as unknown as vscode.Extension<unknown>);
        (vscode.window as { activeTextEditor: unknown }).activeTextEditor = {
            document: { uri: { fsPath: '/elsewhere/file.ts' } },
        };
        vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({
            repository: r1,
        } as never);
        try {
            expect(await GitRepositoryProvider.getActiveRepository()).toBe(r1);
        } finally {
            (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
        }
    });

    it('matches a whole path segment and prefers the innermost repo', async () => {
        const app = fakeRepo('/w/app');
        const appWeb = fakeRepo('/w/app-web');
        const sub = fakeRepo('/w/app/libs/sub');
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate: async () => ({ getAPI: () => ({ repositories: [app, appWeb, sub] }) }),
        } as unknown as vscode.Extension<unknown>);
        const setActive = (fsPath: string) => {
            (vscode.window as { activeTextEditor: unknown }).activeTextEditor = {
                document: { uri: { fsPath } },
            };
        };
        try {
            setActive('/w/app-web/src/x.ts');
            expect(await GitRepositoryProvider.getActiveRepository()).toBe(appWeb);
            setActive('/w/app/libs/sub/y.ts');
            expect(await GitRepositoryProvider.getActiveRepository()).toBe(sub);
            setActive('/w/app/z.ts');
            expect(await GitRepositoryProvider.getActiveRepository()).toBe(app);
        } finally {
            (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
        }
    });
});

describe('GitRepositoryProvider.getActiveRepository no-active-editor branch', () => {
    it('falls back to selectRepository when there is no active editor', async () => {
        const r1 = fakeRepo('/repoA');
        const r2 = fakeRepo('/repoB');
        vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({
            activate: async () => ({ getAPI: () => ({ repositories: [r1, r2] }) }),
        } as unknown as vscode.Extension<unknown>);
        (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
        vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({
            repository: r2,
        } as never);
        expect(await GitRepositoryProvider.getActiveRepository()).toBe(r2);
    });
});

describe('GitService.execGit additional spawn branches', () => {
    type Opts = { signal?: AbortSignal; allowNonZeroExit?: boolean; maxBuffer?: number };
    const execGit = (args: string[], cwd: string, opts?: Opts) =>
        (
            GitService as unknown as {
                execGit: (a: string[], c: string, o?: Opts) => Promise<ExecResult>;
            }
        ).execGit(args, cwd, opts);

    function nextChild(): FakeChild {
        const child = new FakeChild();
        spawnMock.mockReturnValueOnce(child);
        return child;
    }

    it('passes timeout:undefined to spawn when gitTimeout is -1 (branch 636)', async () => {
        vi.spyOn(ConfigService, 'get').mockImplementation((key: string) =>
            key === 'gitTimeout' ? (-1 as never) : (undefined as never),
        );
        const child = nextChild();
        const p = execGit(['status'], '/repo');
        child.emit('close', 0, null);
        await p;
        // The spawn options carried timeout === undefined (no timeout).
        const opts = spawnMock.mock.calls.at(-1)?.[2] as { timeout?: number };
        expect(opts.timeout).toBeUndefined();
    });

    it('does not re-SIGTERM when the buffer overflows again (branch 669 false)', async () => {
        const child = nextChild();
        const p = execGit(['show'], '/repo');
        const big = 'x'.repeat(200_001);
        // Chunk 1: stdout still empty (< cap) -> appended, no overflow yet.
        child.stdout.emit('data', Buffer.from(big));
        // Chunk 2: stdout now >= cap -> enters overflow block, sets the flag,
        // fires the single SIGTERM (`!bufferOverflowed` true).
        child.stdout.emit('data', Buffer.from(big));
        // Chunk 3: already overflowed -> `if (!bufferOverflowed)` is FALSE,
        // so no extra SIGTERM (the uncovered branch-1 path).
        child.stdout.emit('data', Buffer.from(big));
        child.emit('close', null, 'SIGTERM');
        await p;
        expect(child.killSignals.filter((s) => s === 'SIGTERM')).toHaveLength(1);
    });

    it('skips the SIGKILL escalation when the child exited on SIGTERM', async () => {
        const child = new (class extends FakeChild {
            kill(signal?: string): boolean {
                super.kill(signal);
                this.signalCode = signal ?? 'SIGTERM'; // the process honours it
                return true;
            }
        })();
        spawnMock.mockReturnValueOnce(child);
        vi.useFakeTimers();
        const controller = new AbortController();
        const p = execGit(['status'], '/repo', { signal: controller.signal });
        controller.abort(); // onAbort -> SIGTERM -> child exits
        vi.advanceTimersByTime(1600); // grace timer fires; the child is gone
        vi.useRealTimers();
        child.emit('close', null, 'SIGTERM');
        await expect(p).rejects.toThrow(/cancelled/i);
        expect(child.killSignals).not.toContain('SIGKILL');
    });

    it('includes a blank command name in the timeout message for empty args (branch 714 ?? )', async () => {
        const child = nextChild();
        const p = execGit([], '/repo'); // args[0] undefined -> the `?? ''` right side
        child.emit('close', null, 'SIGTERM');
        await expect(p).rejects.toThrow(/Git command timed out after/);
    });

    it('resolves exitCode -1 when close reports a null code with allowNonZeroExit (branch 719 ??)', async () => {
        const child = nextChild();
        const p = execGit(['diff'], '/repo', { allowNonZeroExit: true });
        child.stdout.emit('data', Buffer.from('body'));
        // code null, no SIGTERM signal -> falls to `const exitCode = code ?? -1`.
        child.emit('close', null, null);
        await expect(p).resolves.toEqual({ stdout: 'body', stderr: '', exitCode: -1 });
    });
});
