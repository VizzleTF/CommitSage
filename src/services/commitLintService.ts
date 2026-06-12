/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import * as vscode from 'vscode';

import { Logger } from '../utils/logger';

import { CommitLintCliService } from './commitLintCliService';
import { FORMAT_RULE_SETS, COMMITLINT_COMPATIBLE_FORMATS, CONFIG_DRIVEN_FORMATS, FormatRuleSet } from './formatRules';
import { CommitLintConfig, CommitLintRules, CommitLintResult, ParsedCommit } from '../models/types';

/**
 * project — the repo's own commitlint CLI (full CI parity; falls back to builtin when unavailable);
 * builtin — the bundled static engine with per-format rule sets.
 */
export type CommitLintEngine = 'project' | 'builtin';

export interface CommitLintOptions {
  engine?: CommitLintEngine;
  signal?: AbortSignal;
  /** Selected commitFormat — picks the builtin rule set and gates the project engine. */
  format?: string;
}

const CONFIG_FILES = [
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  'commitlint.config.js',
  'commitlint.config.cjs',
  '.commitlintrc.yml',
  '.commitlintrc.yaml',
  // ESM / TypeScript variants — discovered so the user gets a clear warning
  // instead of a silent fallback to defaults. Not executed.
  'commitlint.config.mjs',
  '.commitlintrc.mjs',
  'commitlint.config.ts',
  '.commitlintrc.ts',
] as const;

const KNOWN_PRESETS: Record<string, CommitLintRules> = {
  '@commitlint/config-conventional': {
    'type-enum':            [2, 'always', ['feat','fix','docs','style','refactor','perf','test','chore','revert','ci','build']],
    'type-case':            [2, 'always', 'lower-case'],
    'type-empty':           [2, 'never'],
    'scope-case':           [2, 'always', 'lower-case'],
    'subject-case':         [2, 'never',  ['sentence-case','start-case','pascal-case','upper-case']],
    'subject-empty':        [2, 'never'],
    'subject-full-stop':    [2, 'never',  '.'],
    'header-max-length':    [2, 'always', 72],
    'body-leading-blank':   [1, 'always'],
    'footer-leading-blank': [1, 'always'],
  },
  // Differs from conventional: no `chore` type and no `!` breaking marker.
  '@commitlint/config-angular': {
    'type-enum':                [2, 'always', ['build','ci','docs','feat','fix','perf','refactor','revert','style','test']],
    'type-case':                [2, 'always', 'lower-case'],
    'type-empty':               [2, 'never'],
    'scope-case':               [2, 'always', 'lower-case'],
    'subject-case':             [2, 'never',  ['sentence-case','start-case','pascal-case','upper-case']],
    'subject-empty':            [2, 'never'],
    'subject-full-stop':        [2, 'never',  '.'],
    'subject-exclamation-mark': [2, 'never'],
    'header-max-length':        [2, 'always', 72],
    'body-leading-blank':       [1, 'always'],
  },
};

const COMMIT_RULES_DEFAULT = `Conventional Commits format rules:
- <type>: A noun describing the type of change (e.g., feat, fix, docs, style, refactor, test, chore).
- <scope>: An optional noun describing the scope of the change (e.g., component or file name).
- <description>: A brief description of the change.

Commit message structure: <type>(<scope>): <description>

Type priority order (when multiple types present):
- feat > fix > docs > style > refactor > test > chore

Additional requirements:
- ONLY return the commit message in the specified format.
- Do NOT include any additional text, explanations, or formatting.
- Analyze the git diff to determine the most significant change.
- Keep the commit message concise and informative.`;

const CASE_LABELS: Record<string, string> = {
  'lower-case':    'lowercase',
  'upper-case':    'UPPERCASE',
  'camel-case':    'camelCase',
  'pascal-case':   'PascalCase',
  'snake-case':    'snake_case',
  'kebab-case':    'kebab-case',
  'sentence-case': 'Sentence case',
  'start-case':    'Start Case',
};

class CommitLintService {
  private static readonly configFiles = CONFIG_FILES;

  static hasConfig(repoPath: string): boolean {
    return this.packageJsonHasConfig(repoPath)
      || this.configFiles.some(file => fs.existsSync(path.join(repoPath, file)));
  }

  private static packageJsonHasConfig(repoPath: string): boolean {
    try {
      const raw = fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8');
      return (JSON.parse(raw) as { commitlint?: unknown }).commitlint !== undefined;
    } catch {
      return false;
    }
  }

  private static resolveConfigPath(repoPath: string, rulesPath?: string): string | null {
    if (rulesPath && rulesPath !== '.') {
      const abs = path.isAbsolute(rulesPath) ? rulesPath : path.join(repoPath, rulesPath);
      try {
        return fs.statSync(abs).isFile() ? abs : null;
      } catch {
        return null;
      }
    }
    // package.json first to match cosmiconfig's search order
    if (this.packageJsonHasConfig(repoPath)) {
      return path.join(repoPath, 'package.json');
    }
    for (const file of this.configFiles) {
      const abs = path.join(repoPath, file);
      if (fs.existsSync(abs)) { return abs; }
    }
    return null;
  }

  private static useProjectEngine(engine: CommitLintEngine, format: string): boolean {
    return engine === 'project'
      && vscode.workspace.isTrusted
      && COMMITLINT_COMPATIBLE_FORMATS.has(format);
  }

  static async extractRules(repoPath: string, rulesPath?: string, opts: CommitLintOptions = {}): Promise<string> {
    const format = opts.format ?? 'conventional';
    if (this.useProjectEngine(opts.engine ?? 'builtin', format)) {
      try {
        // Fully resolved rules: extends chains, community presets and plugins
        // are already applied by the project's own commitlint.
        const resolved = await CommitLintCliService.resolvedRules(repoPath, rulesPath, opts.signal);
        if (resolved) { return this.rulesToInstructions(resolved); }
      } catch (error) {
        Logger.log(`CommitLint: project CLI rule extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      Logger.warn('CommitLint: project engine requested but commitlint CLI is unavailable — using builtin rule extraction');
    }
    return this.extractRulesBuiltin(repoPath, rulesPath, format);
  }

  private static extractRulesBuiltin(repoPath: string, rulesPath: string | undefined, format: string): string {
    try {
      // conventional/angular read the repo's commitlint config when present;
      // every other format is checked against its own static rule set.
      if (CONFIG_DRIVEN_FORMATS.has(format)) {
        const configPath = this.resolveConfigPath(repoPath, rulesPath);
        if (configPath) {
          const rules = this.loadConfig(configPath);
          if (Object.keys(rules).length > 0) { return this.rulesToInstructions(rules); }
        }
      }
      const ruleSet = FORMAT_RULE_SETS[format];
      if (!ruleSet) { return COMMIT_RULES_DEFAULT; }
      return this.rulesToInstructions(ruleSet.rules, ruleSet.headerHint);
    } catch (error) {
      Logger.log(`CommitLint: error extracting rules: ${error instanceof Error ? error.message : String(error)}`);
      return COMMIT_RULES_DEFAULT;
    }
  }

  static async validate(
    message: string,
    repoPath: string,
    rulesPath?: string,
    opts: CommitLintOptions = {},
  ): Promise<CommitLintResult> {
    const format = opts.format ?? 'conventional';
    if (this.useProjectEngine(opts.engine ?? 'builtin', format)) {
      try {
        const cliResult = await CommitLintCliService.validate(message, repoPath, rulesPath, opts.signal);
        if (cliResult) { return cliResult; }
      } catch (error) {
        Logger.log(`CommitLint: project CLI validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      Logger.warn('CommitLint: project engine requested but commitlint CLI is unavailable — using builtin validator');
    }
    return this.validateBuiltin(message, repoPath, rulesPath, format);
  }

  private static validateBuiltin(message: string, repoPath: string, rulesPath: string | undefined, format: string): CommitLintResult {
    try {
      if (CONFIG_DRIVEN_FORMATS.has(format)) {
        const explicitPath = Boolean(rulesPath && rulesPath !== '.');
        const configPath = (explicitPath || this.hasConfig(repoPath))
          ? this.resolveConfigPath(repoPath, rulesPath)
          : null;
        if (configPath) {
          const rules = this.loadConfig(configPath);
          if (Object.keys(rules).length > 0) { return this.validateCommit(message, rules); }
        }
      }
      const ruleSet = FORMAT_RULE_SETS[format];
      if (!ruleSet) { return { valid: true, errors: [] }; }
      return this.validateWithRuleSet(message, ruleSet);
    } catch (error) {
      Logger.log(`CommitLint: validation error: ${error instanceof Error ? error.message : String(error)}`);
      return { valid: true, errors: [] };
    }
  }

  private static validateWithRuleSet(message: string, ruleSet: FormatRuleSet): CommitLintResult {
    if (ruleSet.structural === 'detailed') { return this.validateDetailed(message); }

    const lines = message.split('\n');
    const header = lines[0] ?? '';

    if (ruleSet.headerPattern && !ruleSet.headerPattern.test(header)) {
      return { valid: false, errors: [ruleSet.headerHint ?? 'header does not match the required format'] };
    }

    // Strip the non-conventional lead-in (emoji) so standard rules can run.
    const checked = ruleSet.stripPrefix
      ? [header.replace(ruleSet.stripPrefix, ''), ...lines.slice(1)].join('\n')
      : message;
    return this.validateCommit(checked, ruleSet.rules);
  }

  private static validateDetailed(message: string): CommitLintResult {
    const errors: string[] = [];
    const lines = message.split('\n');
    const header = lines[0] ?? '';

    if (!/^Summary: \S/.test(header)) {
      errors.push('first line must be "Summary: <imperative summary>"');
    } else if (header.length > 'Summary: '.length + 72) {
      errors.push('summary must not be longer than 72 characters');
    }
    if (!lines.some(l => l.trim() === 'Details:')) {
      errors.push('message must contain a "Details:" section');
    }
    if (!lines.some(l => l.trim() === 'Effects:')) {
      errors.push('message must contain an "Effects:" section');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Applies mechanical fixes for rule violations that don't need an LLM round-trip:
   * type/scope casing, trailing full stop, missing blank line before the body.
   * Returns the message unchanged when nothing is fixable.
   */
  static autoFix(message: string, repoPath: string, rulesPath?: string, format = 'conventional'): string {
    try {
      if (CONFIG_DRIVEN_FORMATS.has(format)) {
        const configPath = this.resolveConfigPath(repoPath, rulesPath);
        if (configPath) {
          const rules = this.loadConfig(configPath);
          if (Object.keys(rules).length > 0) { return this.applyAutoFixes(message, rules); }
        }
      }
      const ruleSet = FORMAT_RULE_SETS[format];
      // Emoji-prefixed and structural formats are left to the LLM refinement
      // loop — mechanical header fixes assume a conventional-shaped header.
      if (!ruleSet || ruleSet.stripPrefix || ruleSet.structural) { return message; }
      return this.applyAutoFixes(message, ruleSet.rules);
    } catch (error) {
      Logger.log(`CommitLint: autofix error: ${error instanceof Error ? error.message : String(error)}`);
      return message;
    }
  }

  private static applyAutoFixes(message: string, rules: CommitLintRules): string {
    const lines = message.split('\n');
    let header = lines[0] ?? '';

    if (rules['type-case']?.[0] === 2 && rules['type-case']?.[1] === 'always') {
      const c = rules['type-case'][2];
      if (c === 'lower-case') { header = header.replace(/^[a-zA-Z0-9_-]+/, m => m.toLowerCase()); }
      else if (c === 'upper-case') { header = header.replace(/^[a-zA-Z0-9_-]+/, m => m.toUpperCase()); }
    }

    if (rules['scope-case']?.[0] === 2 && rules['scope-case']?.[1] === 'always') {
      const c = rules['scope-case'][2];
      if (c === 'lower-case') {
        header = header.replace(/^([a-zA-Z0-9_-]+)\(([^)]*)\)/, (_, t: string, s: string) => `${t}(${s.toLowerCase()})`);
      }
    }

    if (rules['subject-full-stop']?.[0] === 2 && rules['subject-full-stop']?.[1] === 'never') {
      const stop = (rules['subject-full-stop'][2] as string) ?? '.';
      while (header.endsWith(stop)) { header = header.slice(0, -stop.length).trimEnd(); }
    }

    lines[0] = header;

    if (rules['body-leading-blank']?.[0] === 2 && rules['body-leading-blank']?.[1] === 'always'
        && lines.length > 1 && lines[1].trim() !== '') {
      lines.splice(1, 0, '');
    }

    return lines.join('\n');
  }

  // ── Config parsing ───────────────────────────────────────────────────────

  private static mergePresets(config: CommitLintConfig, configPath: string, visited: Set<string>): CommitLintRules {
    const presetNames = config.extends
      ? (Array.isArray(config.extends) ? config.extends : [config.extends])
      : [];

    const merged: CommitLintRules = {};
    for (const name of presetNames) {
      if (KNOWN_PRESETS[name]) {
        Object.assign(merged, KNOWN_PRESETS[name]);
      } else if (name.startsWith('.')) {
        Object.assign(merged, this.loadLocalExtends(name, configPath, visited));
      } else {
        Logger.warn(`CommitLint: unknown preset "${name}" — only config-conventional and config-angular are built-in; its rules are ignored`);
      }
    }
    Object.assign(merged, config.rules ?? {});
    return merged;
  }

  /** Resolves `extends: "./base"` relative to the extending config, like commitlint does. */
  private static loadLocalExtends(name: string, configPath: string, visited: Set<string>): CommitLintRules {
    const base = path.resolve(path.dirname(configPath), name);
    const candidates = path.extname(base)
      ? [base]
      : [`${base}.js`, `${base}.cjs`, `${base}.json`, `${base}.yml`, `${base}.yaml`, base];

    for (const candidate of candidates) {
      let stat;
      try { stat = fs.statSync(candidate); } catch { continue; }
      if (!stat.isFile()) { continue; }
      if (visited.has(candidate)) {
        Logger.warn(`CommitLint: circular extends detected at ${candidate} — skipping`);
        return {};
      }
      return this.loadConfig(candidate, visited);
    }
    Logger.warn(`CommitLint: local extends "${name}" not found next to ${path.basename(configPath)}`);
    return {};
  }

  private static parseYamlConfig(content: string): CommitLintConfig {
    const result: CommitLintConfig = { rules: {} };
    const lines = content.split('\n');
    let inRules = false;

    for (const line of lines) {
      // detect top-level section changes
      if (/^\S/.test(line)) {
        inRules = /^rules\s*:/.test(line);
      }

      // extends: inline string  →  extends: '@commitlint/config-conventional'
      const inlineExtends = line.match(/^extends:\s*['"]?([^'"\n\r#]+?)['"]?\s*(?:#.*)?$/);
      if (inlineExtends && !result.extends) {
        result.extends = inlineExtends[1].trim();
      }

      // extends list item  →    - '@commitlint/config-conventional'
      if (!inRules) {
        const listItem = line.match(/^[ \t]+-[ \t]+['"]?([^'"\n\r#]+?)['"]?\s*(?:#.*)?$/);
        if (listItem && Array.isArray(result.extends)) {
          (result.extends as string[]).push(listItem[1].trim());
        } else if (listItem && result.extends === undefined) {
          result.extends = [listItem[1].trim()];
        }
      }

      // rule line (only inside rules: section)  →    type-enum: [2, always, [feat, fix]]
      if (inRules) {
        const ruleMatch = line.match(/^[ \t]+([a-z][a-z-]+):\s*(\[.+\])\s*(?:#.*)?$/);
        if (ruleMatch) {
          try {
            // Quote unquoted bare words so the flow sequence becomes valid JSON
            const json = ruleMatch[2]
              .replace(/'/g, '"')
              .replace(/([[\s,])([a-zA-Z][a-zA-Z0-9-]*)(?=[,\]\s])/g, '$1"$2"');
            result.rules[ruleMatch[1]] = JSON.parse(json);
          } catch { /* skip malformed rule */ }
        }
      }
    }

    return result;
  }

  private static loadConfig(configPath: string, visited: Set<string> = new Set()): CommitLintRules {
    const ext = path.extname(configPath).toLowerCase();
    visited.add(configPath);
    try {
      if (path.basename(configPath) === 'package.json') {
        const pkg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { commitlint?: CommitLintConfig };
        return pkg.commitlint ? this.mergePresets(pkg.commitlint, configPath, visited) : {};
      }

      if (ext === '.mjs' || ext === '.ts') {
        Logger.warn(`CommitLint: ${path.basename(configPath)} is not supported (ESM/TypeScript) — use a JSON or YAML config instead`);
        return {};
      }

      if (ext === '.js' || ext === '.cjs') {
        if (!vscode.workspace.isTrusted) {
          Logger.warn(`CommitLint: skipping JS config in untrusted workspace: ${configPath}`);
          return {};
        }
        const req = createRequire(configPath);
        let mod: CommitLintConfig & { default?: CommitLintConfig };
        try {
          mod = req(configPath) as CommitLintConfig & { default?: CommitLintConfig };
        } catch (e: unknown) {
          if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ERR_REQUIRE_ESM') {
            Logger.warn(`CommitLint: ${path.basename(configPath)} uses ES module syntax — use a JSON or YAML config instead`);
            return {};
          }
          throw e;
        }
        return this.mergePresets(mod?.default ?? mod, configPath, visited);
      }

      const content = fs.readFileSync(configPath, 'utf8');

      if (ext === '.yml' || ext === '.yaml') {
        return this.mergePresets(this.parseYamlConfig(content), configPath, visited);
      }

      // .json — and extensionless .commitlintrc, which cosmiconfig parses as
      // JSON or YAML; mirror that with a YAML fallback.
      try {
        return this.mergePresets(JSON.parse(content) as CommitLintConfig, configPath, visited);
      } catch (jsonError) {
        if (ext === '') {
          return this.mergePresets(this.parseYamlConfig(content), configPath, visited);
        }
        throw jsonError;
      }
    } catch (error) {
      Logger.log(`CommitLint: failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  }

  private static caseStr(v: unknown): string {
    if (Array.isArray(v)) { return v.map(c => CASE_LABELS[c as string] ?? String(c)).join(', '); }
    return CASE_LABELS[v as string] ?? String(v);
  }

  private static rulesToInstructions(rules: CommitLintRules, headerHint?: string): string {
    const lines: string[] = ['Commit message rules for this project:\n'];
    if (headerHint) { lines.push(`- ${headerHint}`); }

    // type
    if (rules['type-enum']?.[2]?.length) {
      lines.push(`- Allowed types: ${(rules['type-enum'][2] as string[]).join(', ')}`);
    }
    if (rules['type-case']?.[2]) {
      lines.push(`- Type must be ${this.caseStr(rules['type-case'][2])}`);
    }
    if (rules['type-empty']?.[0] === 2 && rules['type-empty']?.[1] === 'never') {
      lines.push('- Type is required');
    }
    if (rules['type-max-length']?.[2]) {
      lines.push(`- Type max length: ${rules['type-max-length'][2]} characters`);
    }
    if (rules['type-min-length']?.[2]) {
      lines.push(`- Type min length: ${rules['type-min-length'][2]} characters`);
    }

    // scope
    if (rules['scope-enum']?.[2]?.length) {
      lines.push(`- Allowed scopes: ${(rules['scope-enum'][2] as string[]).join(', ')}`);
    }
    if (rules['scope-case']?.[2]) {
      lines.push(`- Scope must be ${this.caseStr(rules['scope-case'][2])}`);
    }
    if (rules['scope-empty']?.[0] === 2) {
      lines.push(rules['scope-empty'][1] === 'never' ? '- Scope is required' : '- Scope must be omitted');
    }
    if (rules['scope-max-length']?.[2]) {
      lines.push(`- Scope max length: ${rules['scope-max-length'][2]} characters`);
    }
    if (rules['scope-min-length']?.[2]) {
      lines.push(`- Scope min length: ${rules['scope-min-length'][2]} characters`);
    }

    // subject
    if (rules['subject-case']?.[2]) {
      const verb = rules['subject-case'][1] === 'never' ? 'must NOT be' : 'must be';
      lines.push(`- Subject ${verb}: ${this.caseStr(rules['subject-case'][2])}`);
    }
    if (rules['subject-empty']?.[0] === 2 && rules['subject-empty']?.[1] === 'never') {
      lines.push('- Subject is required');
    }
    if (rules['subject-full-stop']?.[0] === 2 && rules['subject-full-stop']?.[1] === 'never') {
      lines.push(`- Subject must not end with "${rules['subject-full-stop'][2] ?? '.'}"`);
    }
    if (rules['subject-max-length']?.[2]) {
      lines.push(`- Subject max length: ${rules['subject-max-length'][2]} characters`);
    }
    if (rules['subject-min-length']?.[2]) {
      lines.push(`- Subject min length: ${rules['subject-min-length'][2]} characters`);
    }
    if (rules['subject-exclamation-mark']?.[0] === 2) {
      lines.push(rules['subject-exclamation-mark'][1] === 'never'
        ? '- Never put "!" before the ":" in the header'
        : '- Always put "!" before the ":" in the header');
    }

    // header
    if (rules['header-max-length']?.[2]) {
      lines.push(`- Header (first line) max length: ${rules['header-max-length'][2]} characters`);
    }
    if (rules['header-min-length']?.[2]) {
      lines.push(`- Header (first line) min length: ${rules['header-min-length'][2]} characters`);
    }
    if (rules['header-full-stop']?.[0] === 2 && rules['header-full-stop']?.[1] === 'never') {
      lines.push(`- Header must not end with "${rules['header-full-stop'][2] ?? '.'}"`);
    }

    // body
    if (rules['body-leading-blank']?.[0] === 2 && rules['body-leading-blank']?.[1] === 'always') {
      lines.push('- Leave a blank line before the body');
    }
    if (rules['body-max-line-length']?.[2]) {
      lines.push(`- Body max line length: ${rules['body-max-line-length'][2]} characters`);
    }
    if (rules['body-max-length']?.[2]) {
      lines.push(`- Body max length: ${rules['body-max-length'][2]} characters`);
    }
    if (rules['body-empty']?.[0] === 2 && rules['body-empty']?.[1] === 'never') {
      lines.push('- Body is required');
    }

    // footer
    if (rules['footer-leading-blank']?.[0] === 2 && rules['footer-leading-blank']?.[1] === 'always') {
      lines.push('- Leave a blank line before the footer');
    }
    if (rules['footer-max-line-length']?.[2]) {
      lines.push(`- Footer max line length: ${rules['footer-max-line-length'][2]} characters`);
    }
    if (rules['footer-max-length']?.[2]) {
      lines.push(`- Footer max length: ${rules['footer-max-length'][2]} characters`);
    }
    if (rules['footer-empty']?.[0] === 2 && rules['footer-empty']?.[1] === 'never') {
      lines.push('- Footer is required');
    }

    // trailers
    for (const ruleName of ['signed-off-by', 'trailer-exists'] as const) {
      if (rules[ruleName]?.[0] === 2 && rules[ruleName]?.[1] === 'always') {
        lines.push(`- End the message with a "${rules[ruleName][2] ?? 'Signed-off-by:'}" trailer line`);
      }
    }

    return lines.length > 1 ? lines.join('\n') : COMMIT_RULES_DEFAULT;
  }

  private static isTrailerLine(line: string): boolean {
    return /^(?:BREAKING[ -]CHANGE: |[A-Za-z][A-Za-z0-9-]*(?:: | #))/.test(line);
  }

  private static parseCommitMessage(message: string): ParsedCommit {
    const lines = message.split('\n');
    const header = lines[0] ?? '';

    // Collect indices of blank lines (skip line 0 which is the header)
    const blankIndices: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '') { blankIndices.push(i); }
    }

    let bodyLines: string[] = [];
    let footerLines: string[] = [];

    if (blankIndices.length > 0) {
      const firstBlank = blankIndices[0];

      let footerBlankIdx = -1;
      for (let b = blankIndices.length - 1; b >= 0; b--) {
        const sectionStart = blankIndices[b] + 1;
        const sectionLines = lines.slice(sectionStart).filter(l => l.trim() !== '');
        if (sectionLines.length > 0 && sectionLines.every(l => this.isTrailerLine(l))) {
          footerBlankIdx = blankIndices[b];
        } else {
          break;
        }
      }

      if (footerBlankIdx > firstBlank) {
        bodyLines  = lines.slice(firstBlank + 1, footerBlankIdx);
        footerLines = lines.slice(footerBlankIdx + 1);
      } else if (footerBlankIdx === firstBlank) {
        footerLines = lines.slice(firstBlank + 1);
      } else {
        bodyLines = lines.slice(firstBlank + 1);
      }
    }

    const body   = bodyLines.join('\n').trim();
    const footer = footerLines.join('\n').trim();

    const headerMatch = header.match(/^([a-zA-Z0-9_-]+)(?:\(([^)]*)\))?!?:\s*(.*)$/);

    return {
      header,
      type:    headerMatch?.[1] ?? '',
      scope:   headerMatch?.[2] ?? null,
      subject: headerMatch?.[3] ?? header,
      body,
      footer,
    };
  }

  private static checkCase(value: string, caseRule: unknown, condition: 'always' | 'never'): boolean {
    const cases = Array.isArray(caseRule) ? caseRule as string[] : [caseRule as string];
    const matches = (c: string): boolean => {
      switch (c) {
        case 'lower-case':    return value === value.toLowerCase();
        case 'upper-case':    return value === value.toUpperCase();
        case 'camel-case':    return /^[a-z][a-zA-Z0-9]*$/.test(value);
        case 'pascal-case':   return /^[A-Z][a-zA-Z0-9]*$/.test(value);
        case 'snake-case':    return /^[a-z][a-z0-9_]*$/.test(value);
        case 'kebab-case':    return /^[a-z][a-z0-9-]*$/.test(value);
        case 'sentence-case': return /^[A-Z]/.test(value);
        case 'start-case':    return value.split(' ').every(w => /^[A-Z]/.test(w));
        default:              return false;
      }
    };
    return condition === 'always' ? cases.some(matches) : !cases.some(matches);
  }

  private static validateCommit(message: string, rules: CommitLintRules): CommitLintResult {
    const errors: string[] = [];
    const { header, type, scope, subject, body, footer } = this.parseCommitMessage(message);
    const msgLines = message.split('\n');

    for (const [ruleName, entry] of Object.entries(rules)) {
      if (!entry || entry[0] !== 2) { continue; }
      const condition = entry[1] as 'always' | 'never';
      const value     = entry[2];
      const empty     = (s: string): boolean => s.trim() === '';

      switch (ruleName) {
        // type
        case 'type-enum': {
          const list = value as string[];
          if (type && (condition === 'never' ? list.includes(type) : !list.includes(type))) {
            errors.push(`type must ${condition === 'never' ? 'not ' : ''}be one of [${list.join(', ')}]`);
          }
          break;
        }
        case 'type-case':
          if (type && !this.checkCase(type, value, condition)) {
            errors.push(`type must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`);
          }
          break;
        case 'type-empty':
          if (condition === 'never' && empty(type)) { errors.push('type may not be empty'); }
          else if (condition === 'always' && !empty(type)) { errors.push('type must be empty'); }
          break;
        case 'type-max-length':
          if (type.length > (value as number)) { errors.push(`type must not be longer than ${value} characters`); }
          break;
        case 'type-min-length':
          if (type.length < (value as number)) { errors.push(`type must not be shorter than ${value} characters`); }
          break;

        // scope
        case 'scope-enum': {
          const list = value as string[];
          if (scope !== null && scope !== '') {
            // commitlint allows multiple scopes delimited by "/", "\" or ","
            const scopes = scope.split(/[/,\\]/).map(s => s.trim()).filter(Boolean);
            const violates = condition === 'never'
              ? scopes.some(s => list.includes(s))
              : !scopes.every(s => list.includes(s));
            if (violates) {
              errors.push(`scope must ${condition === 'never' ? 'not ' : ''}be one of [${list.join(', ')}]`);
            }
          }
          break;
        }
        case 'scope-case':
          if (scope !== null && scope !== '' && !this.checkCase(scope, value, condition)) {
            errors.push(`scope must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`);
          }
          break;
        case 'scope-empty':
          if (condition === 'never' && (scope === null || empty(scope))) { errors.push('scope may not be empty'); }
          else if (condition === 'always' && scope !== null && !empty(scope)) { errors.push('scope must be empty'); }
          break;
        case 'scope-max-length':
          if (scope && scope.length > (value as number)) { errors.push(`scope must not be longer than ${value} characters`); }
          break;
        case 'scope-min-length':
          if (scope && scope.length < (value as number)) { errors.push(`scope must not be shorter than ${value} characters`); }
          break;

        // subject
        case 'subject-case':
          if (subject && !this.checkCase(subject, value, condition)) {
            errors.push(`subject must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`);
          }
          break;
        case 'subject-empty':
          if (condition === 'never' && empty(subject)) { errors.push('subject may not be empty'); }
          break;
        case 'subject-full-stop': {
          const stop = (value as string) ?? '.';
          if (condition === 'never' && subject.endsWith(stop)) { errors.push(`subject may not end with "${stop}"`); }
          else if (condition === 'always' && !subject.endsWith(stop)) { errors.push(`subject must end with "${stop}"`); }
          break;
        }
        case 'subject-max-length':
          if (subject.length > (value as number)) { errors.push(`subject must not be longer than ${value} characters`); }
          break;
        case 'subject-min-length':
          if (subject.length < (value as number)) { errors.push(`subject must not be shorter than ${value} characters`); }
          break;
        case 'subject-exclamation-mark': {
          const hasMark = /^[a-zA-Z0-9_-]+(?:\([^)]*\))?!:/.test(header);
          if (condition === 'never' && hasMark) { errors.push('subject must not have an exclamation mark before the ":" marker'); }
          else if (condition === 'always' && !hasMark) { errors.push('subject must have an exclamation mark before the ":" marker'); }
          break;
        }

        // header
        case 'header-max-length':
          if (header.length > (value as number)) { errors.push(`header must not be longer than ${value} characters`); }
          break;
        case 'header-min-length':
          if (header.length < (value as number)) { errors.push(`header must not be shorter than ${value} characters`); }
          break;
        case 'header-case':
          if (header && !this.checkCase(header, value, condition)) {
            errors.push(`header must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`);
          }
          break;
        case 'header-full-stop': {
          const stop = (value as string) ?? '.';
          if (condition === 'never' && header.endsWith(stop)) { errors.push(`header may not end with "${stop}"`); }
          else if (condition === 'always' && !header.endsWith(stop)) { errors.push(`header must end with "${stop}"`); }
          break;
        }
        case 'header-trim':
          if (header !== header.trim()) { errors.push('header must not have leading or trailing whitespace'); }
          break;

        // body
        case 'body-leading-blank':
          if (condition === 'always' && msgLines.length > 1 && msgLines[1].trim() !== '') {
            errors.push('body must have a leading blank line');
          }
          break;
        case 'body-max-line-length':
          if (body.split('\n').some(l => l.length > (value as number))) {
            errors.push(`body line must not be longer than ${value} characters`);
          }
          break;
        case 'body-max-length':
          if (body.length > (value as number)) { errors.push(`body must not be longer than ${value} characters`); }
          break;
        case 'body-empty':
          if (condition === 'never' && empty(body)) { errors.push('body may not be empty'); }
          break;
        case 'body-min-length':
          if (body.length < (value as number)) { errors.push(`body must not be shorter than ${value} characters`); }
          break;
        case 'body-case':
          if (body && !this.checkCase(body, value, condition)) {
            errors.push(`body must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`);
          }
          break;
        case 'body-full-stop': {
          const stop = (value as string) ?? '.';
          if (body && condition === 'never' && body.endsWith(stop)) { errors.push(`body may not end with "${stop}"`); }
          else if (body && condition === 'always' && !body.endsWith(stop)) { errors.push(`body must end with "${stop}"`); }
          break;
        }

        // footer
        case 'footer-leading-blank': {
          if (condition === 'always' && footer) {
            const firstFooterLine = footer.split('\n')[0];
            const idx = msgLines.indexOf(firstFooterLine);
            if (idx > 0 && msgLines[idx - 1] !== '') {
              errors.push('footer must have a leading blank line');
            }
          }
          break;
        }
        case 'footer-max-line-length':
          if (footer.split('\n').some(l => l.length > (value as number))) {
            errors.push(`footer line must not be longer than ${value} characters`);
          }
          break;
        case 'footer-max-length':
          if (footer.length > (value as number)) { errors.push(`footer must not be longer than ${value} characters`); }
          break;
        case 'footer-empty':
          if (condition === 'never' && empty(footer)) { errors.push('footer may not be empty'); }
          break;
        case 'footer-min-length':
          if (footer.length < (value as number)) { errors.push(`footer must not be shorter than ${value} characters`); }
          break;

        // trailers
        case 'signed-off-by':
        case 'trailer-exists': {
          const trailer = (value as string) ?? 'Signed-off-by:';
          const present = msgLines.some(l => l.startsWith(trailer));
          if (condition === 'always' && !present) { errors.push(`message must contain a "${trailer}" trailer`); }
          else if (condition === 'never' && present) { errors.push(`message must not contain a "${trailer}" trailer`); }
          break;
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

export { CommitLintService };
