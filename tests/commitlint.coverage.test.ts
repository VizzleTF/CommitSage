import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { applyAutoFixes } from '../src/services/commitlint/autoFix';
import { caseStr, checkCase } from '../src/services/commitlint/caseRules';
import { loadConfig, resolveConfigPath } from '../src/services/commitlint/configLoader';
import { rulesToInstructions, COMMIT_RULES_DEFAULT } from '../src/services/commitlint/ruleInstructions';
import { validateCommit, validateWithRuleSet } from '../src/services/commitlint/ruleValidator';
import type { FormatRuleSet } from '../src/services/formatRules';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-cov-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
});

// ─── autoFix.ts ──────────────────────────────────────────────────────────────

describe('applyAutoFixes', () => {
    it('uppercases the type when type-case is upper-case (line 15)', () => {
        const rules = { 'type-case': [2, 'always', 'upper-case'] } as never;
        expect(applyAutoFixes('feat: add thing', rules)).toBe('FEAT: add thing');
    });

    it('leaves the type untouched for an unrecognised case (else-of-else)', () => {
        const rules = { 'type-case': [2, 'always', 'camel-case'] } as never;
        expect(applyAutoFixes('Feat: add thing', rules)).toBe('Feat: add thing');
    });

    it('strips a multi-char custom stop repeatedly', () => {
        const rules = { 'subject-full-stop': [2, 'never', '!!'] } as never;
        expect(applyAutoFixes('feat: wow!!!!', rules)).toBe('feat: wow');
    });

    it('defaults the stop to "." when subject-full-stop has no value (line 26 ??)', () => {
        const rules = { 'subject-full-stop': [2, 'never'] } as never;
        expect(applyAutoFixes('feat: ends here.', rules)).toBe('feat: ends here');
    });

    it('does not insert a blank line when one already exists', () => {
        const rules = { 'body-leading-blank': [2, 'always'] } as never;
        expect(applyAutoFixes('feat: x\n\nbody', rules)).toBe('feat: x\n\nbody');
    });

    it('handles an empty message (header defaults to "")', () => {
        const rules = { 'type-case': [2, 'always', 'lower-case'] } as never;
        expect(applyAutoFixes('', rules)).toBe('');
    });

    it('leaves the scope untouched for a non-lower-case scope-case (line 20 else)', () => {
        // scope-case is active but not 'lower-case' → the lowercasing branch is skipped.
        const rules = { 'scope-case': [2, 'always', 'upper-case'] } as never;
        expect(applyAutoFixes('feat(API): add thing', rules)).toBe('feat(API): add thing');
    });
});

// ─── caseRules.ts ────────────────────────────────────────────────────────────

describe('caseStr', () => {
    it('joins labels for an array of cases', () => {
        expect(caseStr(['lower-case', 'upper-case'])).toBe('lowercase, UPPERCASE');
    });

    it('falls back to String() for an array with an unknown case (line 18)', () => {
        expect(caseStr(['lower-case', 'mystery-case'])).toBe('lowercase, mystery-case');
    });

    it('falls back to String() for an unknown scalar case (line 19)', () => {
        expect(caseStr('mystery-case')).toBe('mystery-case');
    });
});

describe('checkCase', () => {
    it('returns false from the default branch for an unknown case (line 35)', () => {
        // always + unknown case → cases.some(matches) is false → not satisfied.
        expect(checkCase('feat', 'totally-unknown-case', 'always')).toBe(false);
        // never + unknown case → !cases.some(matches) is true → satisfied.
        expect(checkCase('feat', 'totally-unknown-case', 'never')).toBe(true);
    });
});

// ─── configLoader.ts ─────────────────────────────────────────────────────────

describe('resolveConfigPath', () => {
    it('returns null when an explicit rulesPath points to a directory (line 54 isFile false)', () => {
        const sub = path.join(tmpDir, 'adir');
        fs.mkdirSync(sub);
        expect(resolveConfigPath(tmpDir, 'adir')).toBeNull();
    });

    it('returns null when an explicit rulesPath does not exist (statSync throws → catch line 56)', () => {
        expect(resolveConfigPath(tmpDir, 'nope/missing.json')).toBeNull();
    });

    it('returns null when nothing is found by auto-discovery (line 67)', () => {
        expect(resolveConfigPath(tmpDir)).toBeNull();
    });

    it('resolves an absolute explicit rulesPath that is a file', () => {
        const cfg = path.join(tmpDir, '.commitlintrc.json');
        fs.writeFileSync(cfg, '{}');
        expect(resolveConfigPath(tmpDir, cfg)).toBe(cfg);
    });
});

describe('loadConfig mergePresets', () => {
    it('warns and ignores an unknown community preset (line 83)', () => {
        const cfg = path.join(tmpDir, '.commitlintrc.json');
        fs.writeFileSync(cfg, JSON.stringify({
            extends: ['@some/unknown-preset'],
            rules: { 'type-enum': [2, 'always', ['feat', 'kept']] },
        }));
        const rules = loadConfig(cfg);
        // unknown preset ignored, own rules still applied
        expect((rules['type-enum'] as unknown[])[2]).toContain('kept');
    });

    it('accepts a single (non-array) extends string', () => {
        const cfg = path.join(tmpDir, '.commitlintrc.json');
        fs.writeFileSync(cfg, JSON.stringify({ extends: '@commitlint/config-conventional' }));
        const rules = loadConfig(cfg);
        expect(rules['type-enum']).toBeDefined();
    });
});

describe('loadConfig loadLocalExtends', () => {
    it('warns when a local extends target is not found (line 107)', () => {
        const cfg = path.join(tmpDir, '.commitlintrc.json');
        fs.writeFileSync(cfg, JSON.stringify({
            extends: ['./does-not-exist'],
            rules: { 'type-enum': [2, 'always', ['feat', 'own']] },
        }));
        const rules = loadConfig(cfg);
        expect((rules['type-enum'] as unknown[])[2]).toContain('own');
    });

    it('skips a non-file candidate (a directory) when resolving local extends (line 100 continue)', () => {
        // Candidate order is base.js, base.cjs, base.json, …  Make the FIRST tried
        // candidate (base.js) a DIRECTORY so statSync succeeds but isFile() is false
        // → the `continue` on line 100 runs; a real base.json then wins.
        fs.mkdirSync(path.join(tmpDir, 'base.js'));
        fs.writeFileSync(path.join(tmpDir, 'base.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'from-json']] },
        }));
        const cfg = path.join(tmpDir, '.commitlintrc.json');
        fs.writeFileSync(cfg, JSON.stringify({ extends: ['./base'] }));
        const rules = loadConfig(cfg);
        expect((rules['type-enum'] as unknown[])[2]).toContain('from-json');
    });

    it('resolves a local extends with an explicit extension (path.extname branch)', () => {
        fs.writeFileSync(path.join(tmpDir, 'base.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat', 'ext-base']] },
        }));
        const cfg = path.join(tmpDir, '.commitlintrc.json');
        fs.writeFileSync(cfg, JSON.stringify({ extends: ['./base.json'] }));
        const rules = loadConfig(cfg);
        expect((rules['type-enum'] as unknown[])[2]).toContain('ext-base');
    });
});

describe('loadConfig YAML extends parsing', () => {
    it('parses a YAML extends list with multiple items (lines 143-146)', () => {
        const cfg = path.join(tmpDir, '.commitlintrc.yml');
        fs.writeFileSync(cfg, [
            'extends:',
            "  - '@commitlint/config-conventional'",
            "  - '@some/ignored'",
            'rules:',
            '  type-enum: [2, always, [feat, yamlext]]',
        ].join('\n'));
        const rules = loadConfig(cfg);
        expect((rules['type-enum'] as unknown[])[2]).toContain('yamlext');
    });

    it('parses an inline YAML extends string (line 137)', () => {
        const cfg = path.join(tmpDir, '.commitlintrc.yaml');
        fs.writeFileSync(cfg, [
            "extends: '@commitlint/config-conventional'",
            'rules:',
            '  type-enum: [2, always, [feat, inlineext]]',
        ].join('\n'));
        const rules = loadConfig(cfg);
        expect((rules['type-enum'] as unknown[])[2]).toContain('inlineext');
        expect(rules['subject-case']).toBeDefined(); // from preset
    });
});

describe('loadConfig requireJsConfig', () => {
    it('skips a JS config in an untrusted workspace (lines 168-169)', async () => {
        vi.resetModules();
        vi.doMock('vscode', async () => {
            const actual = await vi.importActual<typeof import('../tests/__mocks__/vscode')>('../tests/__mocks__/vscode');
            return { ...actual, workspace: { ...actual.workspace, isTrusted: false } };
        });
        const { loadConfig: load } = await import('../src/services/commitlint/configLoader');
        const cfg = path.join(tmpDir, 'commitlint.config.js');
        fs.writeFileSync(cfg, "module.exports = { rules: { 'type-enum': [2, 'always', ['feat']] } };");
        expect(load(cfg)).toEqual({});
        vi.doUnmock('vscode');
    });

    it('warns and returns {} for an ESM .js config (ERR_REQUIRE_ESM, lines 176-178)', async () => {
        vi.resetModules();
        vi.doMock('node:module', () => ({
            createRequire: () => () => {
                const e = new Error('require of ESM') as NodeJS.ErrnoException;
                e.code = 'ERR_REQUIRE_ESM';
                throw e;
            },
        }));
        const { loadConfig: load } = await import('../src/services/commitlint/configLoader');
        const cfg = path.join(tmpDir, 'commitlint.config.js');
        fs.writeFileSync(cfg, "export default {};");
        expect(load(cfg)).toEqual({});
        vi.doUnmock('node:module');
    });

    it('re-throws a non-ESM require error, caught by loadConfig (line 180 throw → 226)', async () => {
        vi.resetModules();
        vi.doMock('node:module', () => ({
            createRequire: () => () => { throw new SyntaxError('broken'); },
        }));
        const { loadConfig: load } = await import('../src/services/commitlint/configLoader');
        const cfg = path.join(tmpDir, 'commitlint.config.js');
        fs.writeFileSync(cfg, "module.exports = {};");
        expect(load(cfg)).toEqual({});
        vi.doUnmock('node:module');
    });

    it('outer catch handles a non-Error throw from require (line 226 String())', async () => {
        vi.resetModules();
        vi.doMock('node:module', () => ({
            createRequire: () => () => { throw 'plain string require failure'; },
        }));
        const { loadConfig: load } = await import('../src/services/commitlint/configLoader');
        const cfg = path.join(tmpDir, 'commitlint.config.js');
        fs.writeFileSync(cfg, 'module.exports = {};');
        expect(load(cfg)).toEqual({});
        vi.doUnmock('node:module');
    });

    it('loads a valid CJS config and honours module.exports.default', () => {
        const cfg = path.join(tmpDir, '.commitlintrc.cjs');
        fs.writeFileSync(cfg, "module.exports = { default: { rules: { 'type-enum': [2, 'always', ['feat', 'dft']] } } };");
        const rules = loadConfig(cfg);
        expect((rules['type-enum'] as unknown[])[2]).toContain('dft');
    });
});

describe('loadConfig misc branches', () => {
    it('returns {} for a package.json with no commitlint field (line 211 else)', () => {
        const cfg = path.join(tmpDir, 'package.json');
        fs.writeFileSync(cfg, JSON.stringify({ name: 'x' }));
        expect(loadConfig(cfg)).toEqual({});
    });

    it('warns and returns {} for a .ts config (lines 214-217)', () => {
        const cfg = path.join(tmpDir, 'commitlint.config.ts');
        fs.writeFileSync(cfg, 'export default { rules: {} };');
        expect(loadConfig(cfg)).toEqual({});
    });

    it('throws-then-catches for malformed .json with an extension (line 201 throw → 226 catch)', () => {
        const cfg = path.join(tmpDir, '.commitlintrc.json');
        fs.writeFileSync(cfg, '{ not valid json');
        expect(loadConfig(cfg)).toEqual({});
    });

    it('falls back to YAML for malformed extensionless .commitlintrc (line 199)', () => {
        const cfg = path.join(tmpDir, '.commitlintrc');
        fs.writeFileSync(cfg, 'rules:\n  type-enum: [2, always, [feat, yamlfallback]]\n');
        const rules = loadConfig(cfg);
        expect((rules['type-enum'] as unknown[])[2]).toContain('yamlfallback');
    });
});

// ─── ruleInstructions.ts ─────────────────────────────────────────────────────

describe('rulesToInstructions', () => {
    it('returns COMMIT_RULES_DEFAULT when no rule produces a line (line 133 else)', () => {
        expect(rulesToInstructions({})).toBe(COMMIT_RULES_DEFAULT);
    });

    it('prepends the headerHint when supplied (line 123)', () => {
        const result = rulesToInstructions(
            { 'type-enum': [2, 'always', ['feat']] } as never,
            'header must start with an emoji',
        );
        expect(result).toContain('header must start with an emoji');
    });

    it('emits subject-full-stop guidance with default stop "." (line 65)', () => {
        const result = rulesToInstructions({ 'subject-full-stop': [2, 'never'] } as never);
        expect(result).toContain('Subject must not end with "."');
    });

    it('emits header-full-stop guidance with default stop "." (line 78)', () => {
        const result = rulesToInstructions({ 'header-full-stop': [2, 'never'] } as never);
        expect(result).toContain('Header must not end with "."');
    });

    it('emits trailer guidance with the default trailer label (line 115)', () => {
        const result = rulesToInstructions({ 'trailer-exists': [2, 'always'] } as never);
        expect(result).toContain('End the message with a "Signed-off-by:" trailer line');
    });

    it('emits the "must NOT be" verb for subject-case never', () => {
        const result = rulesToInstructions({ 'subject-case': [2, 'never', 'upper-case'] } as never);
        expect(result).toContain('Subject must NOT be: UPPERCASE');
    });
});

// ─── ruleValidator.ts ────────────────────────────────────────────────────────

describe('validateDetailed (via validateWithRuleSet)', () => {
    const detailedSet: FormatRuleSet = { rules: {}, structural: 'detailed' };

    it('flags a summary longer than 72 characters (lines 33-34)', () => {
        const longSummary = 'Summary: ' + 'x'.repeat(80) + '\n\nDetails:\n\nEffects:';
        const result = validateWithRuleSet(longSummary, detailedSet);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('summary must not be longer than 72 characters');
    });

    it('passes a well-formed detailed message', () => {
        const msg = 'Summary: ok\n\nDetails:\n\nEffects:';
        expect(validateWithRuleSet(msg, detailedSet).valid).toBe(true);
    });
});

describe('validateWithRuleSet header pattern', () => {
    it('rejects a header that does not match the pattern (line 16)', () => {
        const set: FormatRuleSet = {
            rules: {},
            headerPattern: /^MATCH/,
            headerHint: 'must start with MATCH',
        };
        const result = validateWithRuleSet('nope here', set);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('must start with MATCH');
    });

    it('uses the default error when no headerHint is given', () => {
        const set: FormatRuleSet = { rules: {}, headerPattern: /^MATCH/ };
        const result = validateWithRuleSet('nope', set);
        expect(result.errors).toContain('header does not match the required format');
    });
});

describe('validateCommit default/unknown rule branches', () => {
    it('ignores a rule whose entry severity is not 2 (continue line 51)', () => {
        const result = validateCommit('anything', { 'type-empty': [1, 'never'] } as never);
        expect(result.valid).toBe(true);
    });

    it('ignores an entirely unknown rule category (evaluateRule default line 80)', () => {
        const result = validateCommit('feat: x', { 'mystery-rule': [2, 'always', 1] } as never);
        expect(result.valid).toBe(true);
    });

    it('ignores an unknown type-* rule (checkTypeRule default line 144)', () => {
        const result = validateCommit('feat: x', { 'type-mystery': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });

    it('ignores an unknown scope-* rule (checkScopeRule default line 169)', () => {
        const result = validateCommit('feat(api): x', { 'scope-mystery': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });

    it('ignores an unknown subject-* rule (checkSubjectRule default line 190)', () => {
        const result = validateCommit('feat: x', { 'subject-mystery': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });

    it('ignores an unknown header-* rule (checkHeaderRule default line 206)', () => {
        const result = validateCommit('feat: x', { 'header-mystery': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });

    it('ignores an unknown body-* rule (checkBodyRule default line 229)', () => {
        const result = validateCommit('feat: x\n\nbody', { 'body-mystery': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });

    it('ignores an unknown footer-* rule (checkFooterRule default line 255)', () => {
        const result = validateCommit('feat: x\n\nbody\n\nFixes: #1', { 'footer-mystery': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });
});

describe('checkHeaderRule header-full-stop always (lines 108-111)', () => {
    it('fails when the header lacks the required full stop', () => {
        const result = validateCommit('feat: no stop', { 'header-full-stop': [2, 'always', '.'] } as never);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('header must end with "."');
    });

    it('passes when the header ends with the required full stop', () => {
        const result = validateCommit('feat: has stop.', { 'header-full-stop': [2, 'always', '.'] } as never);
        expect(result.valid).toBe(true);
    });
});

describe('checkFullStopRule default stop "." (line 109 ??)', () => {
    it('defaults the stop to "." when header-full-stop has no value', () => {
        const result = validateCommit('feat: ends.', { 'header-full-stop': [2, 'never'] } as never);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('header may not end with "."');
    });

    it('skips body-full-stop when the body is empty (skipEmpty line 108)', () => {
        const result = validateCommit('feat: x', { 'body-full-stop': [2, 'always', '.'] } as never);
        expect(result.valid).toBe(true);
    });
});

describe('checkHeaderRule header-trim (lines 204-205)', () => {
    it('fails when the header has trailing whitespace', () => {
        const result = validateCommit('feat: x   ', { 'header-trim': [2, 'always'] } as never);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('header must not have leading or trailing whitespace');
    });

    it('passes when the header is already trimmed', () => {
        const result = validateCommit('feat: x', { 'header-trim': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });
});

describe('checkTrailerRule default trailer value (line 262 ??)', () => {
    it('defaults to "Signed-off-by:" when no trailer value is configured', () => {
        const result = validateCommit('feat: x', { 'signed-off-by': [2, 'always'] } as never);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('must contain a "Signed-off-by:" trailer');
    });
});

describe('checkLengthRule null-field branch (line 118)', () => {
    it('skips scope length rules when scope is null', () => {
        // No scope present → scope is null → checkLengthRule returns null early.
        const result = validateCommit('feat: no scope here', { 'scope-max-length': [2, 'always', 3] } as never);
        expect(result.valid).toBe(true);
    });
});

describe('checkFooterRule footer-leading-blank (lines 242-243)', () => {
    it('fails when the footer line is not preceded by a blank line', () => {
        // The footer's first line ("Signed-off-by: A") also appears earlier right
        // after the non-blank "body" line. indexOf finds that earlier occurrence,
        // so msgLines[idx-1] === "body" (non-blank) → the leading-blank check fails.
        const msg = 'feat: x\n\nbody\nSigned-off-by: A\n\nSigned-off-by: A';
        const result = validateCommit(msg, { 'footer-leading-blank': [2, 'always'] } as never);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('footer must have a leading blank line');
    });

    it('passes when a blank line precedes the footer', () => {
        const msg = 'feat: x\n\nbody\n\nSigned-off-by: A <a@x.io>';
        const result = validateCommit(msg, { 'footer-leading-blank': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });

    it('passes when there is no footer at all (line 239 falsy-footer branch)', () => {
        // condition === 'always' but footer is empty → the `&& footer` short-circuits.
        const result = validateCommit('feat: x\n\njust a body', { 'footer-leading-blank': [2, 'always'] } as never);
        expect(result.valid).toBe(true);
    });
});

// ─── commitLintService.ts ────────────────────────────────────────────────────

describe('CommitLintService no-ruleset formats', () => {
    it('extractRules returns the default prompt for an unknown format (line 89)', async () => {
        const { CommitLintService } = await import('../src/services/commitLintService');
        const result = await CommitLintService.extractRules(tmpDir, undefined, { format: 'no-such-format' });
        expect(result).toBe(COMMIT_RULES_DEFAULT);
    });

    it('validate returns valid:true for an unknown format with no rule set (line 129)', async () => {
        const { CommitLintService } = await import('../src/services/commitLintService');
        const result = await CommitLintService.validate('anything at all', tmpDir, undefined, { format: 'no-such-format' });
        expect(result).toEqual({ valid: true, errors: [] });
    });

    it('autoFix leaves emoji-prefixed formats untouched (stripPrefix branch line 145)', async () => {
        const { CommitLintService } = await import('../src/services/commitLintService');
        const msg = ':sparkles: Add Thing.';
        expect(CommitLintService.autoFix(msg, tmpDir, undefined, 'emoji')).toBe(msg);
    });

    it('autoFix leaves structural (detailed) formats untouched (structural branch line 145)', async () => {
        const { CommitLintService } = await import('../src/services/commitLintService');
        const msg = 'Summary: x';
        expect(CommitLintService.autoFix(msg, tmpDir, undefined, 'detailed')).toBe(msg);
    });

    it('autoFix returns the message for an unknown format (no rule set, line 145)', async () => {
        const { CommitLintService } = await import('../src/services/commitLintService');
        const msg = 'Whatever: text.';
        expect(CommitLintService.autoFix(msg, tmpDir, undefined, 'no-such-format')).toBe(msg);
    });
});

describe('CommitLintService config-loader error paths (catch blocks)', () => {
    beforeEach(() => {
        // conventional is a CONFIG_DRIVEN_FORMAT, so loadConfigDrivenRules runs.
        fs.writeFileSync(path.join(tmpDir, '.commitlintrc.json'), JSON.stringify({
            rules: { 'type-enum': [2, 'always', ['feat']] },
        }));
    });

    const mockLoadConfigThrows = async () => {
        vi.resetModules();
        vi.doMock('../src/services/commitlint/configLoader', async () => {
            const actual = await vi.importActual<typeof import('../src/services/commitlint/configLoader')>(
                '../src/services/commitlint/configLoader',
            );
            return {
                ...actual,
                loadConfig: () => { throw new Error('boom'); },
            };
        });
        return (await import('../src/services/commitLintService')).CommitLintService;
    };

    it('extractRulesBuiltin catch returns the default prompt (lines 92-93)', async () => {
        const Svc = await mockLoadConfigThrows();
        const result = await Svc.extractRules(tmpDir);
        expect(result).toBe(COMMIT_RULES_DEFAULT);
        vi.doUnmock('../src/services/commitlint/configLoader');
    });

    it('validateBuiltin catch returns valid:true (lines 132-133)', async () => {
        const Svc = await mockLoadConfigThrows();
        const result = await Svc.validate('feat: x', tmpDir);
        expect(result).toEqual({ valid: true, errors: [] });
        vi.doUnmock('../src/services/commitlint/configLoader');
    });

    it('autoFix catch returns the original message (lines 148-149)', async () => {
        const Svc = await mockLoadConfigThrows();
        const msg = 'Feat: x.';
        expect(Svc.autoFix(msg, tmpDir)).toBe(msg);
        vi.doUnmock('../src/services/commitlint/configLoader');
    });

    // A non-Error throw exercises the `: String(error)` side of each catch's
    // `error instanceof Error ? … : String(error)` ternary.
    const mockLoadConfigThrowsString = async () => {
        vi.resetModules();
        vi.doMock('../src/services/commitlint/configLoader', async () => {
            const actual = await vi.importActual<typeof import('../src/services/commitlint/configLoader')>(
                '../src/services/commitlint/configLoader',
            );
            return { ...actual, loadConfig: () => { throw 'plain string boom'; } };
        });
        return (await import('../src/services/commitLintService')).CommitLintService;
    };

    it('extractRulesBuiltin catch handles a non-Error throw (line 92 String())', async () => {
        const Svc = await mockLoadConfigThrowsString();
        expect(await Svc.extractRules(tmpDir)).toBe(COMMIT_RULES_DEFAULT);
        vi.doUnmock('../src/services/commitlint/configLoader');
    });

    it('validateBuiltin catch handles a non-Error throw (line 132 String())', async () => {
        const Svc = await mockLoadConfigThrowsString();
        expect(await Svc.validate('feat: x', tmpDir)).toEqual({ valid: true, errors: [] });
        vi.doUnmock('../src/services/commitlint/configLoader');
    });

    it('autoFix catch handles a non-Error throw (line 148 String())', async () => {
        const Svc = await mockLoadConfigThrowsString();
        expect(Svc.autoFix('Feat: x.', tmpDir)).toBe('Feat: x.');
        vi.doUnmock('../src/services/commitlint/configLoader');
    });
});

describe('CommitLintService project engine fallback', () => {
    const mockCli = async (impl: Partial<{
        resolvedRules: (...a: unknown[]) => unknown;
        validate: (...a: unknown[]) => unknown;
    }>) => {
        vi.resetModules();
        vi.doMock('../src/services/commitLintCliService', () => ({
            CommitLintCliService: {
                resolvedRules: impl.resolvedRules ?? (async () => null),
                validate: impl.validate ?? (async () => null),
                detect: () => null,
            },
        }));
        return (await import('../src/services/commitLintService')).CommitLintService;
    };

    afterEach(() => {
        vi.doUnmock('../src/services/commitLintCliService');
    });

    it('extractRules uses the project CLI rules when available (lines 52-54)', async () => {
        const Svc = await mockCli({
            resolvedRules: async () => ({ 'type-enum': [2, 'always', ['feat', 'cliresolved']] }),
        });
        const result = await Svc.extractRules(tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result).toContain('cliresolved');
    });

    it('extractRules falls back to builtin when the CLI returns null (lines 59-61)', async () => {
        const Svc = await mockCli({ resolvedRules: async () => null });
        const result = await Svc.extractRules(tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result).toContain('Allowed types: feat');
    });

    it('extractRules falls back to builtin when the CLI throws (lines 56-57)', async () => {
        const Svc = await mockCli({ resolvedRules: async () => { throw new Error('cli boom'); } });
        const result = await Svc.extractRules(tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result).toContain('Allowed types: feat');
    });

    it('extractRules catch handles a non-Error CLI throw (line 57 String())', async () => {
        const Svc = await mockCli({ resolvedRules: async () => { throw 'cli string boom'; } });
        const result = await Svc.extractRules(tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result).toContain('Allowed types: feat');
    });

    it('validate uses the project CLI verdict when available (lines 107-110)', async () => {
        const Svc = await mockCli({
            validate: async () => ({ valid: false, errors: ['cli says nope'] }),
        });
        const result = await Svc.validate('feat: x', tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result).toEqual({ valid: false, errors: ['cli says nope'] });
    });

    it('validate reports the CLI "valid" verdict branch (line 108)', async () => {
        const Svc = await mockCli({
            validate: async () => ({ valid: true, errors: [] }),
        });
        const result = await Svc.validate('feat: x', tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result).toEqual({ valid: true, errors: [] });
    });

    it('validate falls back to builtin when the CLI returns null (line 115)', async () => {
        const Svc = await mockCli({ validate: async () => null });
        const result = await Svc.validate('feat: ok', tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result.valid).toBe(true);
    });

    it('validate falls back to builtin when the CLI throws (lines 112-113)', async () => {
        const Svc = await mockCli({ validate: async () => { throw new Error('cli boom'); } });
        const result = await Svc.validate('feat: ok', tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result.valid).toBe(true);
    });

    it('validate catch handles a non-Error CLI throw (line 113 String())', async () => {
        const Svc = await mockCli({ validate: async () => { throw 'cli string boom'; } });
        const result = await Svc.validate('feat: ok', tmpDir, undefined, { engine: 'project', format: 'conventional' });
        expect(result.valid).toBe(true);
    });
});
