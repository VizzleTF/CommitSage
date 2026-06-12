import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CommitLintCliService } from '../src/services/commitLintCliService';
import { CommitLintService } from '../src/services/commitLintService';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-cli-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Fake commitlint CLI: validates that our runner speaks the real CLI protocol
 * (stdin message, exit codes, default formatter output, --print-config=json)
 * without installing the real package.
 */
function installFakeCli(root: string, pkgName = 'commitlint'): void {
    const pkgDir = path.join(root, 'node_modules', ...pkgName.split('/'));
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
        name: pkgName,
        bin: pkgName === 'commitlint' ? './cli.js' : { commitlint: './cli.js' },
    }));
    fs.writeFileSync(path.join(pkgDir, 'cli.js'), `
let data = '';
process.stdin.on('data', d => { data += d; });
process.stdin.on('end', () => {
    if (process.argv.includes('--print-config=json')) {
        console.log(JSON.stringify({ rules: { 'type-enum': [2, 'always', ['feat', 'cli-only-rule']] } }));
        process.exit(0);
    }
    if (data.includes('no-rules-here')) {
        console.error('Please add rules to your commitlint config');
        process.exit(1);
    }
    if (data.includes('bad')) {
        console.log('✖   type must be one of [feat, cli-only-rule] [type-enum]');
        console.log('✖   found 1 problems, 0 warnings');
        process.exit(1);
    }
    process.exit(0);
});
`);
}

describe('CommitLintCliService.detect', () => {
    it('finds the commitlint package bin', () => {
        installFakeCli(tmpDir);
        expect(CommitLintCliService.detect(tmpDir)).toBe(
            path.join(tmpDir, 'node_modules', 'commitlint', 'cli.js'),
        );
    });

    it('finds @commitlint/cli with an object bin field', () => {
        installFakeCli(tmpDir, '@commitlint/cli');
        expect(CommitLintCliService.detect(tmpDir)).toBe(
            path.join(tmpDir, 'node_modules', '@commitlint', 'cli', 'cli.js'),
        );
    });

    it('walks up parent directories (monorepo layout)', () => {
        installFakeCli(tmpDir);
        const nested = path.join(tmpDir, 'packages', 'app');
        fs.mkdirSync(nested, { recursive: true });
        expect(CommitLintCliService.detect(nested)).toBe(
            path.join(tmpDir, 'node_modules', 'commitlint', 'cli.js'),
        );
    });

    it('returns null when commitlint is not installed', () => {
        expect(CommitLintCliService.detect(tmpDir)).toBeNull();
    });
});

describe('CommitLintCliService.validate', () => {
    it('returns valid on exit code 0', async () => {
        installFakeCli(tmpDir);
        const result = await CommitLintCliService.validate('feat: fine', tmpDir);
        expect(result).toEqual({ valid: true, errors: [] });
    });

    it('parses error lines and drops the summary line', async () => {
        installFakeCli(tmpDir);
        const result = await CommitLintCliService.validate('bad: nope', tmpDir);
        expect(result?.valid).toBe(false);
        expect(result?.errors).toEqual(['type must be one of [feat, cli-only-rule] [type-enum]']);
    });

    it('returns null (fallback) when the CLI reports a missing config', async () => {
        installFakeCli(tmpDir);
        const result = await CommitLintCliService.validate('no-rules-here', tmpDir);
        expect(result).toBeNull();
    });

    it('returns null when commitlint is not installed', async () => {
        const result = await CommitLintCliService.validate('feat: fine', tmpDir);
        expect(result).toBeNull();
    });
});

describe('CommitLintCliService.resolvedRules', () => {
    it('returns the resolved rules from --print-config=json', async () => {
        installFakeCli(tmpDir);
        const rules = await CommitLintCliService.resolvedRules(tmpDir);
        expect(rules?.['type-enum'][2]).toContain('cli-only-rule');
    });

    it('returns null without an installed CLI', async () => {
        expect(await CommitLintCliService.resolvedRules(tmpDir)).toBeNull();
    });
});

describe('CommitLintService engine selection', () => {
    it('auto engine prefers the project CLI result over the builtin validator', async () => {
        installFakeCli(tmpDir);
        // No static config in the repo at all — only the project CLI knows the rules.
        const result = await CommitLintService.validate('bad: nope', tmpDir, undefined, { engine: 'auto' });
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('cli-only-rule');
    });

    it('builtin engine never spawns the project CLI', async () => {
        installFakeCli(tmpDir);
        // The fake CLI would reject this, but builtin has no config → valid.
        const result = await CommitLintService.validate('bad: nope', tmpDir, undefined, { engine: 'builtin' });
        expect(result.valid).toBe(true);
    });

    it('extractRules uses the fully resolved rules from the project CLI', async () => {
        installFakeCli(tmpDir);
        const rules = await CommitLintService.extractRules(tmpDir, undefined, { engine: 'auto' });
        expect(rules).toContain('cli-only-rule');
    });

    it('falls back to builtin when the project CLI is missing', async () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'static-rule']] },
        }));
        const rules = await CommitLintService.extractRules(tmpDir, undefined, { engine: 'project' });
        expect(rules).toContain('static-rule');
    });
});
