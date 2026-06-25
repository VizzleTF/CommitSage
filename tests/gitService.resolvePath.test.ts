import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';

/**
 * resolveGitPath() memoizes its result in a module-level `cachedGitPath`, so
 * each branch can only run on the FIRST execGit call after a fresh module load.
 * We therefore re-import gitService per test under vi.resetModules(), with a
 * per-test inline vscode mock that steers the `git.path` setting / `vscode.git`
 * extension API path, then read back which binary `spawn` was invoked with.
 *
 * spawn() is captured per test via a module-level holder the child_process mock
 * reads; the holder is swapped before each fresh import.
 */
const spawnHolder: { fn: (...a: unknown[]) => unknown } = {
    fn: () => undefined,
};

vi.mock('node:child_process', () => ({
    spawn: (...args: unknown[]) => spawnHolder.fn(...args),
}));

class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    killed = false;
    kill(): boolean {
        this.killed = true;
        return true;
    }
}

/**
 * Build the vscode mock. `gitPathSetting` drives
 * workspace.getConfiguration('git').get('path'); `extensionApiPath` drives the
 * resolved path exposed by the vscode.git extension API.
 */
function vscodeMock(opts: {
    gitPathSetting?: string | string[];
    extension?: 'absolute' | 'relative' | 'none' | 'throws';
    extensionApiPath?: string;
}): Record<string, unknown> {
    return {
        workspace: {
            getConfiguration: (_section: string) => ({
                get: <T>(_key: string): T | undefined =>
                    opts.gitPathSetting as unknown as T,
            }),
        },
        extensions: {
            getExtension: (_id: string) => {
                if (opts.extension === 'none' || opts.extension === undefined) {
                    return undefined;
                }
                if (opts.extension === 'throws') {
                    throw new Error('extension lookup blew up');
                }
                return {
                    exports: {
                        getAPI: (_v: number) => ({
                            git: { path: opts.extensionApiPath },
                        }),
                    },
                };
            },
        },
        // Minimal surfaces other imported modules may touch at load time.
        window: {
            createOutputChannel: () => ({
                appendLine: () => undefined,
                append: () => undefined,
                show: () => undefined,
                dispose: () => undefined,
                trace: () => undefined,
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
                logLevel: 0,
                onDidChangeLogLevel: () => ({ dispose: () => undefined }),
            }),
        },
        env: { machineId: 'm', isTelemetryEnabled: true },
        l10n: { t: (m: string) => m },
    };
}

/**
 * Load a fresh gitService with the given vscode mock, then invoke execGit once
 * (driving a clean exit) and return the binary spawn was called with.
 */
async function resolveSpawnedBinary(
    vscodeImpl: Record<string, unknown>,
): Promise<string> {
    vi.resetModules();
    vi.doMock('vscode', () => vscodeImpl);

    let spawnedCmd = '';
    const child = new FakeChild();
    spawnHolder.fn = (cmd: unknown) => {
        spawnedCmd = cmd as string;
        return child;
    };

    const { GitService } = await import('../src/services/gitService');
    const execGit = (GitService as unknown as {
        execGit: (a: string[], c: string) => Promise<unknown>;
    }).execGit;

    const p = execGit(['rev-parse', 'HEAD'], '/repo');
    // Let the synchronous spawn() + listener wiring settle, then close cleanly.
    await Promise.resolve();
    child.stdout.emit('data', Buffer.from('ok'));
    child.emit('close', 0, null);
    await p;

    vi.doUnmock('vscode');
    return spawnedCmd;
}

afterEach(() => {
    vi.resetModules();
    vi.doUnmock('vscode');
});

describe('resolveGitPath (per-fresh-module cache branches)', () => {
    const absA = path.resolve('/usr/bin/git');
    const absB = path.resolve('/opt/homebrew/bin/git');

    it('uses a configured absolute string git.path (lines 34-40)', async () => {
        const binary = await resolveSpawnedBinary(
            vscodeMock({ gitPathSetting: absA }),
        );
        expect(binary).toBe(absA);
    });

    it('uses the first absolute entry from an array git.path (lines 32-40)', async () => {
        // First entry relative (skipped by the isAbsolute guard), second absolute.
        const binary = await resolveSpawnedBinary(
            vscodeMock({ gitPathSetting: ['relative/git', absB] }),
        );
        expect(binary).toBe(absB);
    });

    it('ignores a relative configured path and falls through to the extension API (lines 34,43-47)', async () => {
        const binary = await resolveSpawnedBinary(
            vscodeMock({
                gitPathSetting: 'relative/git', // not absolute -> no candidate matches
                extension: 'absolute',
                extensionApiPath: absA,
            }),
        );
        expect(binary).toBe(absA);
    });

    it('falls through to the extension API when git.path is unset (lines 43-47)', async () => {
        const binary = await resolveSpawnedBinary(
            vscodeMock({
                gitPathSetting: undefined,
                extension: 'absolute',
                extensionApiPath: absB,
            }),
        );
        expect(binary).toBe(absB);
    });

    it('falls back to bare "git" when the extension API path is relative (lines 45-53)', async () => {
        const binary = await resolveSpawnedBinary(
            vscodeMock({
                extension: 'relative',
                extensionApiPath: 'relative/git',
            }),
        );
        expect(binary).toBe('git');
    });

    it('falls back to bare "git" when nothing resolves (lines 52-53)', async () => {
        const binary = await resolveSpawnedBinary(
            vscodeMock({ gitPathSetting: undefined, extension: 'none' }),
        );
        expect(binary).toBe('git');
    });

    it('falls back to bare "git" when resolution throws (catch path, lines 49-53)', async () => {
        const binary = await resolveSpawnedBinary(
            vscodeMock({ gitPathSetting: undefined, extension: 'throws' }),
        );
        expect(binary).toBe('git');
    });

    it('memoizes after the first resolution (cached path reused)', async () => {
        vi.resetModules();
        vi.doMock('vscode', () => vscodeMock({ gitPathSetting: absA }));

        const calls: string[] = [];
        spawnHolder.fn = (cmd: unknown) => {
            calls.push(cmd as string);
            const child = new FakeChild();
            queueMicrotask(() => {
                child.stdout.emit('data', Buffer.from('ok'));
                child.emit('close', 0, null);
            });
            return child;
        };

        const { GitService } = await import('../src/services/gitService');
        const execGit = (GitService as unknown as {
            execGit: (a: string[], c: string) => Promise<unknown>;
        }).execGit;

        await execGit(['rev-parse'], '/repo');
        await execGit(['status'], '/repo');

        // Both calls used the same cached absolute binary.
        expect(calls).toEqual([absA, absA]);
        vi.doUnmock('vscode');
    });
});
