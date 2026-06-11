import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CommitLintService } from '../src/services/commitLintService';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-cl-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── hasConfig ───────────────────────────────────────────────────────────────

describe('CommitLintService.hasConfig', () => {
    it('returns false when no config file exists', () => {
        expect(CommitLintService.hasConfig(tmpDir)).toBe(false);
    });

    it('returns true for commitlint.config.js', () => {
        fs.writeFileSync(path.join(tmpDir, 'commitlint.config.js'), 'module.exports = { rules: {} }');
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
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.yml'), 'rules: {}');
        expect(CommitLintService.hasConfig(tmpDir)).toBe(true);
    });
});

// ─── extractRules ────────────────────────────────────────────────────────────

describe('CommitLintService.extractRules', () => {
    it('returns default rules when no config file exists', () => {
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('Conventional Commits');
    });

    it('returns default rules when config has no rules', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({ rules: {} }));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('Conventional Commits');
    });

    it('extracts type-enum from JSON config', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'docs']] },
        }));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('feat, fix, chore, docs');
    });

    it('extracts subject-max-length from JSON config', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'subject-max-length': [2, 'always', 72] },
        }));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('72 characters');
    });

    it('extracts body-max-line-length from JSON config', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'body-max-line-length': [2, 'always', 100] },
        }));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('100 characters');
    });

    it('extracts subject-case as array from JSON config', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'subject-case': [2, 'always', ['lower-case', 'sentence-case']] },
        }));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('lowercase');
        expect(result).toContain('Sentence case');
    });

    it('notes when scope is required', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'scope-empty': [2, 'never'] },
        }));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('Scope is required');
    });

    it('applies @commitlint/config-conventional preset via extends', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            extends: ['@commitlint/config-conventional'],
        }));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('feat');
        expect(result).toContain('fix');
    });

    it('auto-discovers config when rulesPath is "." (the old default value)', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'fix', 'dot-default']] },
        }));
        // "." resolves to the repo root directory — must trigger auto-discovery, not EISDIR
        const result = CommitLintService.extractRules(tmpDir, '.');
        expect(result).toContain('dot-default');
    });

    it('respects rulesPath pointing to a specific file', () => {
        const subDir = path.join(tmpDir, 'config');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(subDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'custom']] },
        }));
        const result = CommitLintService.extractRules(tmpDir, 'config/.commitlintrc.json');
        expect(result).toContain('custom');
    });

    it('respects absolute rulesPath', () => {
        const configPath = path.join(tmpDir, '.commitlintrc.json');
        fs.writeFileSync(configPath, JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'absolute']] },
        }));
        const result = CommitLintService.extractRules('/some/other/repo', configPath);
        expect(result).toContain('absolute');
    });

    it('parses .commitlintrc.yml with flow-sequence rules', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.yml'), [
            'rules:',
            '  type-enum: [2, always, [feat, fix, docs]]',
            '  header-max-length: [2, always, 80]',
        ].join('\n'));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('feat');
        expect(result).toContain('80 characters');
    });

    it('parses .commitlintrc.yaml with extends preset', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.yaml'), [
            'extends:',
            '  - "@commitlint/config-conventional"',
        ].join('\n'));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('feat');
        expect(result).toContain('fix');
    });

    it('parses .commitlintrc (no extension) as JSON', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'hotfix']] },
        }));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('hotfix');
    });

    it('parses commitlint.config.js (CommonJS)', () => {
        fs.writeFileSync(path.join(tmpDir, 'commitlint.config.js'), [
            "module.exports = {",
            "  rules: {",
            "    'type-enum': [2, 'always', ['feat', 'fix', 'cjs-type']],",
            "    'header-max-length': [2, 'always', 60],",
            "  }",
            "};",
        ].join('\n'));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('cjs-type');
        expect(result).toContain('60 characters');
    });

    it('parses .commitlintrc.cjs (CommonJS)', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.cjs'), [
            "module.exports = {",
            "  rules: { 'type-enum': [2, 'always', ['feat', 'cjs-rc-type']] }",
            "};",
        ].join('\n'));
        const result = CommitLintService.extractRules(tmpDir);
        expect(result).toContain('cjs-rc-type');
    });
});

// ─── validate ────────────────────────────────────────────────────────────────

describe('CommitLintService.validate', () => {
    it('returns valid:true when no config file exists in repo', () => {
        const result = CommitLintService.validate('feat: something', tmpDir);
        expect(result).toEqual({ valid: true, errors: [] });
    });

    it('returns valid:true when message passes type-enum rule', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'fix']] },
        }));
        const result = CommitLintService.validate('feat: add thing', tmpDir);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('returns errors when type is not in type-enum', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'fix']] },
        }));
        const result = CommitLintService.validate('wip: something', tmpDir);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('type must be one of [feat, fix]');
    });

    it('returns errors when header exceeds max length', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'header-max-length': [2, 'always', 20] },
        }));
        const result = CommitLintService.validate('feat: this is way too long for the limit', tmpDir);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('header must not be longer than 20');
    });

    it('returns errors when subject ends with full-stop', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'subject-full-stop': [2, 'never', '.'] },
        }));
        const result = CommitLintService.validate('feat: add thing.', tmpDir);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('subject may not end with "."');
    });

    it('returns valid:true when config has no rules (empty rules object)', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({ rules: {} }));
        const result = CommitLintService.validate('wip: anything goes', tmpDir);
        expect(result.valid).toBe(true);
    });

    it('degrades gracefully when config file is malformed JSON', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), '{ bad json }');
        const result = CommitLintService.validate('feat: ok', tmpDir);
        expect(result).toEqual({ valid: true, errors: [] });
    });

    it('validates against @commitlint/config-conventional preset', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            extends: ['@commitlint/config-conventional'],
        }));
        const invalid = CommitLintService.validate('WIP: something', tmpDir);
        expect(invalid.valid).toBe(false);

        const valid = CommitLintService.validate('feat: add new feature', tmpDir);
        expect(valid.valid).toBe(true);
    });

    it('catches body-leading-blank when content follows header without blank line', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'body-leading-blank': [2, 'always'] },
        }));
        const result = CommitLintService.validate('feat: add thing\nNo blank line before body', tmpDir);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('leading blank line');
    });

    it('body-leading-blank passes when blank line separates header from body', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'body-leading-blank': [2, 'always'] },
        }));
        const result = CommitLintService.validate('feat: add thing\n\nProper body here', tmpDir);
        expect(result.valid).toBe(true);
    });
});

// ─── footer parsing ──────────────────────────────────────────────────────────

describe('CommitLintService footer parsing', () => {
    beforeEach(() => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'footer-max-length': [2, 'always', 200] },
        }));
    });

    it('does not treat a second body paragraph as footer', () => {
        // Multi-paragraph body with no trailers — footer should be empty
        const msg = 'feat: add thing\n\nParagraph one.\n\nParagraph two.';
        const result = CommitLintService.validate(msg, tmpDir);
        expect(result.valid).toBe(true);
    });

    it('detects BREAKING CHANGE as footer when preceded by blank line', () => {
        const msg = 'feat: add thing\n\nBody text.\n\nBREAKING CHANGE: removes old API';
        // body-max-length test: body should be "Body text.", not include the trailer
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'body-max-length': [2, 'always', 20] },
        }));
        const result = CommitLintService.validate(msg, tmpDir);
        // "Body text." is 10 chars — passes if footer is correctly separated
        expect(result.valid).toBe(true);
    });

    it('separates multi-paragraph body from git trailers', () => {
        // If second paragraph was mistakenly treated as footer, body-max-length
        // would only see "Paragraph one." and pass even with a tight limit.
        // With correct parsing both paragraphs count toward body length.
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'body-max-length': [2, 'always', 20] },
        }));
        const msg = 'feat: add thing\n\nParagraph one.\n\nParagraph two that is long.';
        const result = CommitLintService.validate(msg, tmpDir);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('body must not be longer than 20');
    });
});

// ─── package.json config ─────────────────────────────────────────────────────

describe('CommitLintService package.json config', () => {
    it('discovers the commitlint field in package.json', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            name: 'x',
            commitlint: { rules: { 'type-enum': [2, 'always', ['feat', 'pkg-json']] } },
        }));
        expect(CommitLintService.hasConfig(tmpDir)).toBe(true);
        expect(CommitLintService.extractRules(tmpDir)).toContain('pkg-json');
    });

    it('validates against rules from package.json', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            commitlint: { rules: { 'type-enum': [2, 'always', ['feat']] } },
        }));
        expect(CommitLintService.validate('fix: nope', tmpDir).valid).toBe(false);
        expect(CommitLintService.validate('feat: yep', tmpDir).valid).toBe(true);
    });

    it('ignores package.json without a commitlint field', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'x' }));
        expect(CommitLintService.hasConfig(tmpDir)).toBe(false);
        expect(CommitLintService.extractRules(tmpDir)).toContain('Conventional Commits');
    });

    it('prefers package.json over rc files (cosmiconfig order)', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            commitlint: { rules: { 'type-enum': [2, 'always', ['from-pkg']] } },
        }));
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['from-rc']] },
        }));
        expect(CommitLintService.extractRules(tmpDir)).toContain('from-pkg');
    });
});

// ─── autoFix ─────────────────────────────────────────────────────────────────

describe('CommitLintService.autoFix', () => {
    it('lowercases the type when type-case demands lower-case', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-case': [2, 'always', 'lower-case'] },
        }));
        expect(CommitLintService.autoFix('Feat: add thing', tmpDir)).toBe('feat: add thing');
    });

    it('lowercases the scope when scope-case demands lower-case', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'scope-case': [2, 'always', 'lower-case'] },
        }));
        expect(CommitLintService.autoFix('feat(API): add thing', tmpDir)).toBe('feat(api): add thing');
    });

    it('strips a trailing full stop when subject-full-stop is never', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'subject-full-stop': [2, 'never', '.'] },
        }));
        expect(CommitLintService.autoFix('feat: add thing.', tmpDir)).toBe('feat: add thing');
    });

    it('inserts a blank line before the body when body-leading-blank is always', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'body-leading-blank': [2, 'always'] },
        }));
        expect(CommitLintService.autoFix('feat: add thing\nbody here', tmpDir))
            .toBe('feat: add thing\n\nbody here');
    });

    it('applies multiple fixes at once and the result passes validation', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: {
                'type-case': [2, 'always', 'lower-case'],
                'subject-full-stop': [2, 'never', '.'],
                'body-leading-blank': [2, 'always'],
            },
        }));
        const fixed = CommitLintService.autoFix('Feat: add thing.\nbody here', tmpDir);
        expect(fixed).toBe('feat: add thing\n\nbody here');
        expect(CommitLintService.validate(fixed, tmpDir).valid).toBe(true);
    });

    it('returns the message unchanged when nothing is fixable', () => {
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'header-max-length': [2, 'always', 10] },
        }));
        const msg = 'feat: this header is definitely way too long';
        expect(CommitLintService.autoFix(msg, tmpDir)).toBe(msg);
    });

    it('returns the message unchanged when no config exists', () => {
        expect(CommitLintService.autoFix('Whatever: text.', tmpDir)).toBe('Whatever: text.');
    });
});
