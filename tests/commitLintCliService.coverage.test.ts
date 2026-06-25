import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CommitLintCliService } from '../src/services/commitLintCliService';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-cli-cov-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * Fake commitlint CLI that echoes whether a --config arg was passed, so we can
 * prove configArgs() forwarded the rulesPath. It also lets us assert against a
 * known config absolute path via stderr.
 */
function installConfigEchoCli(root: string): void {
    const pkgDir = path.join(root, 'node_modules', 'commitlint');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'commitlint', bin: './cli.js' }),
    );
    fs.writeFileSync(
        path.join(pkgDir, 'cli.js'),
        `
let data = '';
process.stdin.on('data', d => { data += d; });
process.stdin.on('end', () => {
    const i = process.argv.indexOf('--config');
    const configVal = i >= 0 ? process.argv[i + 1] : '<none>';
    // Surface the resolved config arg so the test can assert on it.
    console.log('✖   config=' + configVal + ' [config-arg]');
    process.exit(1);
});
`,
    );
}

/** Fake CLI that hangs forever, to exercise the run() timeout/SIGKILL path. */
function installHangingCli(root: string): void {
    const pkgDir = path.join(root, 'node_modules', 'commitlint');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'commitlint', bin: './cli.js' }),
    );
    fs.writeFileSync(
        path.join(pkgDir, 'cli.js'),
        `setInterval(() => {}, 1000); process.stdin.resume();`,
    );
}

describe('CommitLintCliService.configArgs (via validate with rulesPath)', () => {
    it('passes a relative rulesPath resolved against repoPath as --config', async () => {
        installConfigEchoCli(tmpDir);
        const result = await CommitLintCliService.validate(
            'feat: x',
            tmpDir,
            'configs/custom.config.js',
        );
        expect(result?.valid).toBe(false);
        const expectedAbs = path.join(tmpDir, 'configs/custom.config.js');
        expect(result?.errors[0]).toContain(`config=${expectedAbs}`);
    });

    it('passes an absolute rulesPath through unchanged', async () => {
        installConfigEchoCli(tmpDir);
        const abs = path.join(tmpDir, 'abs.config.js');
        const result = await CommitLintCliService.validate('feat: x', tmpDir, abs);
        expect(result?.errors[0]).toContain(`config=${abs}`);
    });

    it('omits --config when rulesPath is "." (project default search)', async () => {
        installConfigEchoCli(tmpDir);
        const result = await CommitLintCliService.validate('feat: x', tmpDir, '.');
        expect(result?.errors[0]).toContain('config=<none>');
    });

    it('omits --config when rulesPath is empty', async () => {
        installConfigEchoCli(tmpDir);
        const result = await CommitLintCliService.validate('feat: x', tmpDir, '');
        expect(result?.errors[0]).toContain('config=<none>');
    });
});

/** Fake CLI that prints non-JSON to stdout for --print-config=json. */
function installBadJsonCli(root: string): void {
    const pkgDir = path.join(root, 'node_modules', 'commitlint');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'commitlint', bin: './cli.js' }),
    );
    fs.writeFileSync(
        path.join(pkgDir, 'cli.js'),
        `
process.stdin.resume();
process.stdin.on('end', () => {
    // Pre-v19 commitlint prints human-readable text, not JSON.
    console.log('Config not printable as JSON in this version');
    process.exit(0);
});
`,
    );
}

describe('CommitLintCliService.resolvedRules JSON.parse fallback', () => {
    it('returns null when --print-config output is not valid JSON', async () => {
        installBadJsonCli(tmpDir);
        expect(await CommitLintCliService.resolvedRules(tmpDir)).toBeNull();
    });
});

describe('CommitLintCliService.run timeout (SIGKILL path)', () => {
    it('returns null (fallback) when the CLI exceeds RUN_TIMEOUT_MS', async () => {
        installHangingCli(tmpDir);
        // Drive the private RUN_TIMEOUT_MS timeout deterministically with fake timers.
        vi.useFakeTimers();
        const promise = CommitLintCliService.validate('feat: x', tmpDir);
        // Fire the 30s timeout -> SIGKILL -> child 'close' -> finish(null).
        await vi.advanceTimersByTimeAsync(30_001);
        vi.useRealTimers();
        const result = await promise;
        expect(result).toBeNull();
    });
});

/** CLI that exits non-zero with output that has NO "✖" formatter lines. */
function installPlainErrorCli(root: string): void {
    const pkgDir = path.join(root, 'node_modules', 'commitlint');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'commitlint', bin: './cli.js' }),
    );
    fs.writeFileSync(
        path.join(pkgDir, 'cli.js'),
        `
process.stdin.resume();
process.stdin.on('end', () => {
    console.error('some unstructured failure without bullets');
    process.exit(1);
});
`,
    );
}

/** CLI whose --print-config exits NON-zero (resolvedRules early-null path). */
function installPrintConfigFailCli(root: string): void {
    const pkgDir = path.join(root, 'node_modules', 'commitlint');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'commitlint', bin: './cli.js' }),
    );
    fs.writeFileSync(
        path.join(pkgDir, 'cli.js'),
        `
process.stdin.resume();
process.stdin.on('end', () => {
    console.error('cannot print config');
    process.exit(2);
});
`,
    );
}

/** CLI whose --print-config emits valid JSON but with an empty/absent rules map. */
function installEmptyRulesCli(root: string): void {
    const pkgDir = path.join(root, 'node_modules', 'commitlint');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'commitlint', bin: './cli.js' }),
    );
    fs.writeFileSync(
        path.join(pkgDir, 'cli.js'),
        `
process.stdin.resume();
process.stdin.on('end', () => {
    console.log(JSON.stringify({ rules: {} }));
    process.exit(0);
});
`,
    );
}

describe('CommitLintCliService.detect bin-points-to-missing-file', () => {
    it('returns null when package.json bin path does not exist on disk', () => {
        const pkgDir = path.join(tmpDir, 'node_modules', 'commitlint');
        fs.mkdirSync(pkgDir, { recursive: true });
        // bin references a cli.js we never create -> fs.existsSync(cliPath) is false.
        fs.writeFileSync(
            path.join(pkgDir, 'package.json'),
            JSON.stringify({ name: 'commitlint', bin: './nope.js' }),
        );
        expect(CommitLintCliService.detect(tmpDir)).toBeNull();
    });
});

describe('CommitLintCliService.validate output-without-bullets', () => {
    it('falls back to the raw trimmed output when there are no "✖" lines', async () => {
        installPlainErrorCli(tmpDir);
        const result = await CommitLintCliService.validate('bad: nope', tmpDir);
        expect(result?.valid).toBe(false);
        // errors.length === 0 path -> [output.trim()] is used.
        expect(result?.errors).toHaveLength(1);
        expect(result?.errors[0]).toContain('some unstructured failure');
    });
});

describe('CommitLintCliService.resolvedRules non-success / empty-rules', () => {
    it('returns null when --print-config exits non-zero', async () => {
        installPrintConfigFailCli(tmpDir);
        expect(await CommitLintCliService.resolvedRules(tmpDir)).toBeNull();
    });

    it('returns null when the printed config has an empty rules map', async () => {
        installEmptyRulesCli(tmpDir);
        expect(await CommitLintCliService.resolvedRules(tmpDir)).toBeNull();
    });
});
