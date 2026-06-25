import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * These cases need to drive the child-process lifecycle directly (an `error`
 * event with no `close`, and a double-settle race), which a real spawned CLI
 * can't reliably produce. We mock node:child_process.spawn to hand back a fake
 * child we control, then exercise CommitLintCliService.run() via the public
 * validate()/resolvedRules() entrypoints. detect() still hits the real fs, so
 * we install a real (never-executed) bin on disk.
 */
const spawnHolder: { fn: (...a: unknown[]) => unknown } = { fn: () => undefined };

vi.mock('node:child_process', () => ({
    spawn: (...args: unknown[]) => spawnHolder.fn(...args),
}));

class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    stdin = Object.assign(new EventEmitter(), {
        write: () => true,
        end: () => undefined,
    });
    killed = false;
    kill(): boolean {
        this.killed = true;
        return true;
    }
}

import { CommitLintCliService } from '../src/services/commitLintCliService';

let tmpDir: string;

/** Install a real package.json+bin so detect() resolves a path (run() is mocked). */
function installDetectableCli(root: string): void {
    const pkgDir = path.join(root, 'node_modules', 'commitlint');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'commitlint', bin: './cli.js' }),
    );
    fs.writeFileSync(path.join(pkgDir, 'cli.js'), '// stub, never executed\n');
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-cli-spawn-'));
    installDetectableCli(tmpDir);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    spawnHolder.fn = () => undefined;
});

describe('CommitLintCliService.run via spawn mock', () => {
    it('treats a spawn "error" event as a failed run -> validate returns null', async () => {
        const child = new FakeChild();
        spawnHolder.fn = () => child;
        const p = CommitLintCliService.validate('feat: x', tmpDir);
        // No close; only an error -> finish(null) -> exitCode === null branch.
        await Promise.resolve();
        child.emit('error', new Error('spawn ENOENT'));
        expect(await p).toBeNull();
    });

    it('ignores a late "close" after an "error" already settled (settled guard)', async () => {
        const child = new FakeChild();
        spawnHolder.fn = () => child;
        const p = CommitLintCliService.validate('feat: x', tmpDir);
        await Promise.resolve();
        // First settle via error -> finish(null).
        child.emit('error', new Error('boom'));
        // Second event must be a no-op (the `if (settled) return` guard).
        child.emit('close', 0);
        expect(await p).toBeNull();
    });

    it('resolves a clean exit 0 (control case proving the mock wiring works)', async () => {
        const child = new FakeChild();
        spawnHolder.fn = () => child;
        const p = CommitLintCliService.validate('feat: x', tmpDir);
        await Promise.resolve();
        child.stdout.emit('data', Buffer.from(''));
        child.emit('close', 0);
        expect(await p).toEqual({ valid: true, errors: [] });
    });

    it('kills the child with SIGKILL when the abort signal fires (line 176 listener)', async () => {
        const child = new FakeChild();
        spawnHolder.fn = () => child;
        const controller = new AbortController();
        const p = CommitLintCliService.validate('feat: x', tmpDir, undefined, controller.signal);
        await Promise.resolve();
        controller.abort(); // -> the signal 'abort' listener calls child.kill('SIGKILL')
        expect(child.killed).toBe(true);
        // Let the run settle so the promise resolves and is awaited.
        child.emit('close', null);
        await p;
    });

    it('swallows a stdin "error" event (EPIPE handler, line 183)', async () => {
        const child = new FakeChild();
        spawnHolder.fn = () => child;
        const p = CommitLintCliService.validate('feat: x', tmpDir);
        await Promise.resolve();
        // Emitting 'error' on stdin must be swallowed by the registered handler
        // (an unhandled 'error' on an EventEmitter would otherwise throw).
        expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow();
        child.emit('close', 0);
        expect(await p).toEqual({ valid: true, errors: [] });
    });
});
