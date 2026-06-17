import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CommitLintService } from '../src/services/commitLintService';

/**
 * Targeted coverage for the per-category rule checkers (checkTypeRule,
 * checkScopeRule, checkSubjectRule, checkHeaderRule, checkBodyRule,
 * checkFooterRule, checkTrailerRule) and the rulesToInstructions category
 * helpers. Each rule is exercised through the PUBLIC validate/extractRules API
 * with both a PASSING and a FAILING message so both branches run.
 */

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-cl-checkers-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Writes a .commitlintrc.json with the given rules and validates `msg` against it. */
const validateWith = async (rules: Record<string, unknown>, msg: string) => {
    fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({ rules }));
    return CommitLintService.validate(msg, tmpDir);
};

/** Writes a config and returns the generated rule instructions string. */
const instructionsFor = async (rules: Record<string, unknown>) => {
    fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({ rules }));
    return CommitLintService.extractRules(tmpDir);
};

// ─── checkTypeRule ───────────────────────────────────────────────────────────

describe('checkTypeRule', () => {
    it('type-case lower-case: fails when type is uppercase, passes when lower', async () => {
        const rules = { 'type-case': [2, 'always', 'lower-case'] };
        expect((await validateWith(rules, 'FEAT: x')).valid).toBe(false);
        expect((await validateWith(rules, 'feat: x')).valid).toBe(true);
    });

    it('type-case never upper-case: fails when type IS uppercase', async () => {
        const rules = { 'type-case': [2, 'never', 'upper-case'] };
        const result = await validateWith(rules, 'FEAT: x');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('type must be not');
    });

    it('type-empty always: fails when type present, passes when empty', async () => {
        const rules = { 'type-empty': [2, 'always'] };
        // header without a "type:" structure → parsed type is empty → passes
        expect((await validateWith(rules, 'just a plain message')).valid).toBe(true);
        // a real type present → must be empty → fails
        const failed = await validateWith(rules, 'feat: has a type');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('type must be empty');
    });

    it('type-max-length: fails over limit, passes under', async () => {
        const rules = { 'type-max-length': [2, 'always', 4] };
        const failed = await validateWith(rules, 'refactor: too long type');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('type must not be longer than 4');
        expect((await validateWith(rules, 'feat: ok')).valid).toBe(true);
    });

    it('type-min-length: fails under limit, passes at/over', async () => {
        const rules = { 'type-min-length': [2, 'always', 4] };
        const failed = await validateWith(rules, 'ci: short');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('type must not be shorter than 4');
        expect((await validateWith(rules, 'feat: ok')).valid).toBe(true);
    });

    it('rulesToInstructions emits type-max-length and type-min-length', async () => {
        const result = await instructionsFor({
            'type-max-length': [2, 'always', 10],
            'type-min-length': [2, 'always', 2],
        });
        expect(result).toContain('Type max length: 10 characters');
        expect(result).toContain('Type min length: 2 characters');
    });
});

// ─── checkScopeRule ──────────────────────────────────────────────────────────

describe('checkScopeRule', () => {
    it('scope-enum never: fails when scope in the banned list', async () => {
        const rules = { 'scope-enum': [2, 'never', ['wip']] };
        const failed = await validateWith(rules, 'feat(wip): banned scope');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('scope must not be one of');
        expect((await validateWith(rules, 'feat(api): fine')).valid).toBe(true);
    });

    it('scope-enum: skips check when scope absent', async () => {
        const rules = { 'scope-enum': [2, 'always', ['api']] };
        expect((await validateWith(rules, 'feat: no scope at all')).valid).toBe(true);
    });

    it('scope-case lower-case: fails on uppercase scope, passes on lower', async () => {
        const rules = { 'scope-case': [2, 'always', 'lower-case'] };
        const failed = await validateWith(rules, 'feat(API): x');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('scope must be lowercase');
        expect((await validateWith(rules, 'feat(api): x')).valid).toBe(true);
    });

    it('scope-empty always: requires the scope be omitted', async () => {
        const rules = { 'scope-empty': [2, 'always'] };
        const failed = await validateWith(rules, 'feat(api): has scope');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('scope must be empty');
        expect((await validateWith(rules, 'feat: no scope')).valid).toBe(true);
    });

    it('scope-empty never: requires a scope', async () => {
        const rules = { 'scope-empty': [2, 'never'] };
        expect((await validateWith(rules, 'feat: no scope')).valid).toBe(false);
        expect((await validateWith(rules, 'feat(api): has scope')).valid).toBe(true);
    });

    it('scope-max-length: fails over limit, passes under', async () => {
        const rules = { 'scope-max-length': [2, 'always', 3] };
        const failed = await validateWith(rules, 'feat(backend): long scope');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('scope must not be longer than 3');
        expect((await validateWith(rules, 'feat(api): ok')).valid).toBe(true);
    });

    it('scope-min-length: fails under limit, passes over', async () => {
        const rules = { 'scope-min-length': [2, 'always', 4] };
        const failed = await validateWith(rules, 'feat(ui): short scope');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('scope must not be shorter than 4');
        expect((await validateWith(rules, 'feat(core): ok')).valid).toBe(true);
    });

    it('rulesToInstructions emits scope-enum/max/min instructions', async () => {
        const result = await instructionsFor({
            'scope-enum': [2, 'always', ['api', 'ui']],
            'scope-max-length': [2, 'always', 10],
            'scope-min-length': [2, 'always', 2],
        });
        expect(result).toContain('Allowed scopes: api, ui');
        expect(result).toContain('Scope max length: 10 characters');
        expect(result).toContain('Scope min length: 2 characters');
    });

    it('rulesToInstructions notes scope must be omitted for scope-empty always', async () => {
        const result = await instructionsFor({ 'scope-empty': [2, 'always'] });
        expect(result).toContain('Scope must be omitted');
    });
});

// ─── checkSubjectRule ────────────────────────────────────────────────────────

describe('checkSubjectRule', () => {
    it('subject-case never sentence-case: fails when capitalized, passes when lower', async () => {
        const rules = { 'subject-case': [2, 'never', ['sentence-case', 'pascal-case']] };
        const failed = await validateWith(rules, 'feat: Capitalized subject');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('subject must be not');
        expect((await validateWith(rules, 'feat: lowercase subject')).valid).toBe(true);
    });

    it('subject-empty never: fails on empty subject', async () => {
        const rules = { 'subject-empty': [2, 'never'] };
        expect((await validateWith(rules, 'feat: ')).valid).toBe(false);
        expect((await validateWith(rules, 'feat: present')).valid).toBe(true);
    });

    it('subject-full-stop always: requires trailing stop', async () => {
        const rules = { 'subject-full-stop': [2, 'always', '.'] };
        const failed = await validateWith(rules, 'feat: no stop');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('subject must end with "."');
        expect((await validateWith(rules, 'feat: has stop.')).valid).toBe(true);
    });

    it('subject-max-length: fails over limit, passes under', async () => {
        const rules = { 'subject-max-length': [2, 'always', 10] };
        const failed = await validateWith(rules, 'feat: this subject is far too long');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('subject must not be longer than 10');
        expect((await validateWith(rules, 'feat: short')).valid).toBe(true);
    });

    it('subject-min-length: fails under limit, passes over', async () => {
        const rules = { 'subject-min-length': [2, 'always', 10] };
        const failed = await validateWith(rules, 'feat: tiny');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('subject must not be shorter than 10');
        expect((await validateWith(rules, 'feat: a long enough subject')).valid).toBe(true);
    });

    it('subject-exclamation-mark never: fails when "!" present before ":"', async () => {
        const rules = { 'subject-exclamation-mark': [2, 'never'] };
        const failed = await validateWith(rules, 'feat!: breaking');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('exclamation mark');
        expect((await validateWith(rules, 'feat: normal')).valid).toBe(true);
    });

    it('subject-exclamation-mark always: fails when "!" missing', async () => {
        const rules = { 'subject-exclamation-mark': [2, 'always'] };
        expect((await validateWith(rules, 'feat: no mark')).valid).toBe(false);
        expect((await validateWith(rules, 'feat!: has mark')).valid).toBe(true);
    });

    it('rulesToInstructions emits subject min-length and exclamation guidance', async () => {
        const result = await instructionsFor({
            'subject-min-length': [2, 'always', 5],
            'subject-exclamation-mark': [2, 'always'],
        });
        expect(result).toContain('Subject min length: 5 characters');
        expect(result).toContain('Always put "!" before the ":"');
    });

    it('rulesToInstructions emits "Never put" for subject-exclamation-mark never', async () => {
        const result = await instructionsFor({ 'subject-exclamation-mark': [2, 'never'] });
        expect(result).toContain('Never put "!" before the ":"');
    });
});

// ─── checkHeaderRule ─────────────────────────────────────────────────────────

describe('checkHeaderRule', () => {
    it('header-min-length: fails under limit, passes over', async () => {
        const rules = { 'header-min-length': [2, 'always', 20] };
        const failed = await validateWith(rules, 'feat: short');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('header must not be shorter than 20');
        expect((await validateWith(rules, 'feat: a sufficiently long header line')).valid).toBe(true);
    });

    it('header-case lower-case: fails on uppercase header content', async () => {
        const rules = { 'header-case': [2, 'always', 'lower-case'] };
        const failed = await validateWith(rules, 'FEAT: HEADER');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('header must be lowercase');
        expect((await validateWith(rules, 'feat: header')).valid).toBe(true);
    });

    it('header-full-stop always: requires trailing stop', async () => {
        const rules = { 'header-full-stop': [2, 'always', '.'] };
        const failed = await validateWith(rules, 'feat: no stop');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('header must end with "."');
        expect((await validateWith(rules, 'feat: with stop.')).valid).toBe(true);
    });

    it('rulesToInstructions emits header min-length and full-stop guidance', async () => {
        const result = await instructionsFor({
            'header-min-length': [2, 'always', 10],
            'header-full-stop': [2, 'never', '.'],
        });
        expect(result).toContain('Header (first line) min length: 10 characters');
        expect(result).toContain('Header must not end with "."');
    });
});

// ─── checkBodyRule ───────────────────────────────────────────────────────────

describe('checkBodyRule', () => {
    it('body-max-line-length: fails when a body line is too long', async () => {
        const rules = { 'body-max-line-length': [2, 'always', 10] };
        const failed = await validateWith(rules, 'feat: x\n\nThis body line is too long');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('body line must not be longer than 10');
        expect((await validateWith(rules, 'feat: x\n\nshort')).valid).toBe(true);
    });

    it('body-empty never: fails when body missing', async () => {
        const rules = { 'body-empty': [2, 'never'] };
        expect((await validateWith(rules, 'feat: no body')).valid).toBe(false);
        expect((await validateWith(rules, 'feat: with body\n\nhere it is')).valid).toBe(true);
    });

    it('body-case lower-case: fails when body has uppercase', async () => {
        const rules = { 'body-case': [2, 'always', 'lower-case'] };
        const failed = await validateWith(rules, 'feat: x\n\nUPPER body');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('body must be lowercase');
        expect((await validateWith(rules, 'feat: x\n\nlower body')).valid).toBe(true);
    });

    it('body-full-stop never: fails when body ends with stop', async () => {
        const rules = { 'body-full-stop': [2, 'never', '.'] };
        const failed = await validateWith(rules, 'feat: x\n\nbody ends with dot.');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('body may not end with "."');
        expect((await validateWith(rules, 'feat: x\n\nbody no dot')).valid).toBe(true);
    });

    it('body-full-stop always: fails when body lacks the stop', async () => {
        const rules = { 'body-full-stop': [2, 'always', '.'] };
        const failed = await validateWith(rules, 'feat: x\n\nbody without dot');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('body must end with "."');
        expect((await validateWith(rules, 'feat: x\n\nbody with dot.')).valid).toBe(true);
    });

    it('rulesToInstructions emits body leading-blank/max-line/max/empty guidance', async () => {
        const result = await instructionsFor({
            'body-leading-blank': [2, 'always'],
            'body-max-line-length': [2, 'always', 100],
            'body-max-length': [2, 'always', 500],
            'body-empty': [2, 'never'],
        });
        expect(result).toContain('Leave a blank line before the body');
        expect(result).toContain('Body max line length: 100 characters');
        expect(result).toContain('Body max length: 500 characters');
        expect(result).toContain('Body is required');
    });
});

// ─── checkCase variants ──────────────────────────────────────────────────────

describe('checkCase variants (via type/scope/subject)', () => {
    it('camel-case: passes camelCase scope, fails otherwise', async () => {
        const rules = { 'scope-case': [2, 'always', 'camel-case'] };
        expect((await validateWith(rules, 'feat(myScope): x')).valid).toBe(true);
        expect((await validateWith(rules, 'feat(My-Scope): x')).valid).toBe(false);
    });

    it('pascal-case: passes PascalCase type, fails otherwise', async () => {
        const rules = { 'type-case': [2, 'always', 'pascal-case'] };
        expect((await validateWith(rules, 'Feat: x')).valid).toBe(true);
        expect((await validateWith(rules, 'feat: x')).valid).toBe(false);
    });

    it('snake-case: passes snake_case scope, fails otherwise', async () => {
        const rules = { 'scope-case': [2, 'always', 'snake-case'] };
        expect((await validateWith(rules, 'feat(my_scope): x')).valid).toBe(true);
        expect((await validateWith(rules, 'feat(MyScope): x')).valid).toBe(false);
    });

    it('kebab-case: passes kebab-case scope, fails otherwise', async () => {
        const rules = { 'scope-case': [2, 'always', 'kebab-case'] };
        expect((await validateWith(rules, 'feat(my-scope): x')).valid).toBe(true);
        expect((await validateWith(rules, 'feat(My_Scope): x')).valid).toBe(false);
    });

    it('start-case: passes Start Case subject, fails otherwise', async () => {
        const rules = { 'subject-case': [2, 'always', 'start-case'] };
        expect((await validateWith(rules, 'feat: Add New Feature')).valid).toBe(true);
        expect((await validateWith(rules, 'feat: add new feature')).valid).toBe(false);
    });
});

// ─── config loading edge cases ───────────────────────────────────────────────

describe('config loading edge cases', () => {
    it('warns and ignores ESM/TypeScript configs (.ts) via rulesPath', async () => {
        const cfg = path.join(tmpDir, 'commitlint.config.ts');
        fs.writeFileSync(cfg, 'export default { rules: {} };');
        // .ts config returns no rules → falls back to the static conventional set.
        const result = await CommitLintService.validate('wip: anything', tmpDir, 'commitlint.config.ts');
        expect(result.valid).toBe(false);
    });

    it('warns and ignores .mjs configs, falling back to static rules', async () => {
        const cfg = path.join(tmpDir, 'commitlint.config.mjs');
        fs.writeFileSync(cfg, 'export default { rules: {} };');
        const result = await CommitLintService.extractRules(tmpDir, 'commitlint.config.mjs');
        // No rules extracted → default conventional instructions.
        expect(result).toContain('Allowed types: feat');
    });
});

// ─── checkFooterRule ─────────────────────────────────────────────────────────

describe('checkFooterRule', () => {
    it('footer-leading-blank always: passes when a blank line precedes the footer', async () => {
        // A blank line between body and trailer block makes parseCommitMessage
        // split the footer out; the leading-blank check then runs and passes.
        const rules = { 'footer-leading-blank': [2, 'always'] };
        expect((await validateWith(rules, 'feat: x\n\nbody text\n\nSigned-off-by: A <a@x.io>')).valid).toBe(true);
        // Trailer directly after the header (footerBlankIdx === firstBlank) — also valid.
        expect((await validateWith(rules, 'feat: x\n\nSigned-off-by: A <a@x.io>')).valid).toBe(true);
    });

    it('footer-max-line-length: fails when a footer line too long', async () => {
        const rules = { 'footer-max-line-length': [2, 'always', 15] };
        const longFooter = 'feat: x\n\nbody\n\nReviewed-by: A Very Long Name Here <reviewer@example.com>';
        const failed = await validateWith(rules, longFooter);
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('footer line must not be longer than 15');
        expect((await validateWith(rules, 'feat: x\n\nbody\n\nFixes: #1')).valid).toBe(true);
    });

    it('footer-max-length: fails when total footer exceeds limit', async () => {
        const rules = { 'footer-max-length': [2, 'always', 10] };
        const failed = await validateWith(rules, 'feat: x\n\nbody\n\nReviewed-by: someone long');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('footer must not be longer than 10');
        expect((await validateWith(rules, 'feat: x\n\nbody\n\nFix: #1')).valid).toBe(true);
    });

    it('footer-empty never: fails when no footer present', async () => {
        const rules = { 'footer-empty': [2, 'never'] };
        expect((await validateWith(rules, 'feat: no footer\n\njust body')).valid).toBe(false);
        expect((await validateWith(rules, 'feat: x\n\nbody\n\nFixes: #1')).valid).toBe(true);
    });

    it('footer-min-length: fails when footer too short', async () => {
        const rules = { 'footer-min-length': [2, 'always', 20] };
        const failed = await validateWith(rules, 'feat: x\n\nbody\n\nFix: #1');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('footer must not be shorter than 20');
        expect((await validateWith(rules, 'feat: x\n\nbody\n\nReviewed-by: Long Reviewer Name')).valid).toBe(true);
    });

    it('rulesToInstructions emits footer leading-blank/max/empty guidance', async () => {
        const result = await instructionsFor({
            'footer-leading-blank': [2, 'always'],
            'footer-max-line-length': [2, 'always', 100],
            'footer-max-length': [2, 'always', 200],
            'footer-empty': [2, 'never'],
        });
        expect(result).toContain('Leave a blank line before the footer');
        expect(result).toContain('Footer max line length: 100 characters');
        expect(result).toContain('Footer max length: 200 characters');
        expect(result).toContain('Footer is required');
    });
});

// ─── checkTrailerRule ────────────────────────────────────────────────────────

describe('checkTrailerRule', () => {
    it('signed-off-by never: fails when the trailer IS present', async () => {
        const rules = { 'signed-off-by': [2, 'never', 'Signed-off-by:'] };
        const failed = await validateWith(rules, 'feat: x\n\nbody\n\nSigned-off-by: A <a@x.io>');
        expect(failed.valid).toBe(false);
        expect(failed.errors[0]).toContain('must not contain a "Signed-off-by:" trailer');
        expect((await validateWith(rules, 'feat: no trailer')).valid).toBe(true);
    });

    it('trailer-exists always: requires the configured trailer', async () => {
        const rules = { 'trailer-exists': [2, 'always', 'Reviewed-by:'] };
        expect((await validateWith(rules, 'feat: no trailer')).valid).toBe(false);
        expect((await validateWith(rules, 'feat: x\n\nbody\n\nReviewed-by: A <a@x.io>')).valid).toBe(true);
    });

    it('rulesToInstructions emits the trailer guidance line', async () => {
        const result = await instructionsFor({ 'signed-off-by': [2, 'always', 'Signed-off-by:'] });
        expect(result).toContain('Signed-off-by:');
    });
});
