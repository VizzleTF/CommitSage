import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock lazy-loaded commitlint packages before importing the service.
// CommitLintService uses `await import(...)` internally; vi.mock intercepts those.
vi.mock('@commitlint/load', () => ({ default: vi.fn() }));
vi.mock('@commitlint/lint', () => ({ default: vi.fn() }));

import { CommitLintService } from '../src/services/commitLintService';

function clearModuleCache(): void {
    // CommitLintService caches the lazy-imported modules in static fields.
    // Reset them between tests so each test controls its own mock behaviour.
    (CommitLintService as unknown as Record<string, unknown>).commitLintLoadModule = null;
    (CommitLintService as unknown as Record<string, unknown>).commitLintLintModule = null;
}

// Convenience: build a mock `load` function that returns a resolved config.
function makeLoad(rules: Record<string, unknown> = {}, parserPreset?: unknown) {
    return vi.fn().mockResolvedValue({ rules, parserPreset });
}

// Convenience: build a mock `lint` function that returns a given report.
function makeLint(valid: boolean, errors: Array<{ message: string }> = []) {
    return vi.fn().mockResolvedValue({ valid, errors });
}

// ─── hasConfig ───────────────────────────────────────────────────────────────

describe('CommitLintService.hasConfig', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-cl-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns false when no config file exists', () => {
        expect(CommitLintService.hasConfig(tmpDir)).toBe(false);
    });

    it('returns true for commitlint.config.js', () => {
        fs.writeFileSync(path.join(tmpDir, 'commitlint.config.js'), 'module.exports = {}');
        expect(CommitLintService.hasConfig(tmpDir)).toBe(true);
    });

    it('returns true for .commitlintrc.json', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), '{}');
        expect(CommitLintService.hasConfig(tmpDir)).toBe(true);
    });

    it('returns true for .commitlintrc (no extension)', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc'), '{}');
        expect(CommitLintService.hasConfig(tmpDir)).toBe(true);
    });

    it('returns true for .commitlintrc.yml', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.yml'), 'extends: []');
        expect(CommitLintService.hasConfig(tmpDir)).toBe(true);
    });
});

// ─── extractRules ────────────────────────────────────────────────────────────

describe('CommitLintService.extractRules', () => {
    const REPO = '/fake/repo';

    beforeEach(clearModuleCache);

    it('returns default rules when @commitlint/load throws (no config found)', async () => {
        const { default: load } = await import('@commitlint/load');
        vi.mocked(load).mockRejectedValueOnce(new Error('No config'));

        const result = await CommitLintService.extractRules(REPO);
        expect(result).toContain('Conventional Commits');
    });

    it('returns default rules when config has no rules', async () => {
        const { default: load } = await import('@commitlint/load');
        vi.mocked(load).mockImplementation(makeLoad({}));

        const result = await CommitLintService.extractRules(REPO);
        expect(result).toContain('Conventional Commits');
    });

    it('extracts type-enum from resolved config (handles extends)', async () => {
        const { default: load } = await import('@commitlint/load');
        vi.mocked(load).mockImplementation(makeLoad({
            'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'docs']],
        }));

        const result = await CommitLintService.extractRules(REPO);
        expect(result).toContain('feat, fix, chore, docs');
    });

    it('extracts subject-max-length', async () => {
        const { default: load } = await import('@commitlint/load');
        vi.mocked(load).mockImplementation(makeLoad({
            'subject-max-length': [2, 'always', 72],
        }));

        const result = await CommitLintService.extractRules(REPO);
        expect(result).toContain('72 characters');
    });

    it('extracts body-max-line-length', async () => {
        const { default: load } = await import('@commitlint/load');
        vi.mocked(load).mockImplementation(makeLoad({
            'body-max-line-length': [2, 'always', 100],
        }));

        const result = await CommitLintService.extractRules(REPO);
        expect(result).toContain('100 characters');
    });

    it('extracts subject-case as array', async () => {
        const { default: load } = await import('@commitlint/load');
        vi.mocked(load).mockImplementation(makeLoad({
            'subject-case': [2, 'always', ['lower-case', 'sentence-case']],
        }));

        const result = await CommitLintService.extractRules(REPO);
        expect(result).toContain('lower-case, sentence-case');
    });

    it('notes when scope is required', async () => {
        const { default: load } = await import('@commitlint/load');
        vi.mocked(load).mockImplementation(makeLoad({
            'scope-empty': [2, 'never'],
        }));

        const result = await CommitLintService.extractRules(REPO);
        expect(result).toContain('Scope is required');
    });

    it('passes rulesPath as cwd to @commitlint/load', async () => {
        const { default: load } = await import('@commitlint/load');
        const mockLoad = makeLoad({ 'type-enum': [2, 'always', ['feat']] });
        vi.mocked(load).mockImplementation(mockLoad);

        await CommitLintService.extractRules(REPO, 'config');
        expect(mockLoad).toHaveBeenCalledWith({ cwd: path.join(REPO, 'config') });
    });

    it('resolves absolute rulesPath directly', async () => {
        const { default: load } = await import('@commitlint/load');
        const mockLoad = makeLoad({ 'type-enum': [2, 'always', ['feat']] });
        vi.mocked(load).mockImplementation(mockLoad);

        await CommitLintService.extractRules(REPO, '/absolute/path');
        expect(mockLoad).toHaveBeenCalledWith({ cwd: '/absolute/path' });
    });
});

// ─── validate ────────────────────────────────────────────────────────────────

describe('CommitLintService.validate', () => {
    let tmpDir: string;

    beforeEach(() => {
        clearModuleCache();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-cl-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('returns valid:true when no config file exists in repo', async () => {
        const result = await CommitLintService.validate('feat: something', tmpDir);
        expect(result).toEqual({ valid: true, errors: [] });
    });

    it('returns valid:true when lint passes', async () => {
        fs.writeFileSync(path.join(tmpDir, 'commitlint.config.js'), '');

        const { default: load } = await import('@commitlint/load');
        const { default: lint } = await import('@commitlint/lint');
        vi.mocked(load).mockImplementation(makeLoad({ 'type-enum': [2, 'always', ['feat']] }));
        vi.mocked(lint).mockImplementation(makeLint(true));

        const result = await CommitLintService.validate('feat: add thing', tmpDir);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('returns errors when lint fails', async () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), '{}');

        const { default: load } = await import('@commitlint/load');
        const { default: lint } = await import('@commitlint/lint');
        vi.mocked(load).mockImplementation(makeLoad({ 'type-enum': [2, 'always', ['feat', 'fix']] }));
        vi.mocked(lint).mockImplementation(makeLint(false, [
            { message: 'type must be one of [feat, fix]' },
        ]));

        const result = await CommitLintService.validate('wip: something', tmpDir);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('type must be one of [feat, fix]');
    });

    it('degrades gracefully when @commitlint/load throws', async () => {
        fs.writeFileSync(path.join(tmpDir, 'commitlint.config.js'), '');

        const { default: load } = await import('@commitlint/load');
        vi.mocked(load).mockRejectedValueOnce(new Error('load crashed'));

        const result = await CommitLintService.validate('feat: ok', tmpDir);
        expect(result).toEqual({ valid: true, errors: [] });
    });

    it('passes parserOpts from preset to lint', async () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), '{}');

        const parserOpts = { headerPattern: /^(\w+): (.+)$/ };
        const { default: load } = await import('@commitlint/load');
        const { default: lint } = await import('@commitlint/lint');
        const mockLoad = makeLoad({}, { parserOpts });
        const mockLint = makeLint(true);
        vi.mocked(load).mockImplementation(mockLoad);
        vi.mocked(lint).mockImplementation(mockLint);

        await CommitLintService.validate('feat: thing', tmpDir);
        expect(mockLint).toHaveBeenCalledWith(
            'feat: thing',
            {},
            { parserOpts },
        );
    });
});
