/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
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

/** Parsed commit parts plus the raw split lines, passed to per-category rule checkers. */
interface RuleContext extends ParsedCommit {
  msgLines: string[];
}

const isEmpty = (s: string): boolean => s.trim() === '';

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
        if (resolved) {
          Logger.log(`CommitLint: prompt rules from project CLI (${Object.keys(resolved).length} resolved rules)`);
          return this.rulesToInstructions(resolved);
        }
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
        if (cliResult) {
          const cliVerdict = cliResult.valid ? 'valid' : `invalid (${cliResult.errors.length} errors: ${cliResult.errors.join('; ')})`;
          Logger.log(`CommitLint: project CLI verdict — ${cliVerdict}`);
          return cliResult;
        }
      } catch (error) {
        Logger.log(`CommitLint: project CLI validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      Logger.warn('CommitLint: project engine requested but commitlint CLI is unavailable — using builtin validator');
    }
    const result = this.validateBuiltin(message, repoPath, rulesPath, format);
    const builtinVerdict = result.valid ? 'valid' : `invalid (${result.errors.length} errors: ${result.errors.join('; ')})`;
    Logger.log(`CommitLint: builtin verdict (${format}) — ${builtinVerdict}`);
    return result;
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

      this.parseYamlExtendsLine(line, inRules, result);

      // rule line (only inside rules: section)  →    type-enum: [2, always, [feat, fix]]
      if (inRules) {
        this.parseYamlRuleLine(line, result);
      }
    }

    return result;
  }

  private static parseYamlExtendsLine(line: string, inRules: boolean, result: CommitLintConfig): void {
    // extends: inline string  →  extends: '@commitlint/config-conventional'
    const inlineExtends = /^extends:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(line);
    if (inlineExtends && !result.extends) {
      result.extends = inlineExtends[1].trim();
    }

    // extends list item  →    - '@commitlint/config-conventional'
    if (inRules) { return; }
    const listItem = /^[ \t]+-[ \t]+['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(line);
    if (listItem && Array.isArray(result.extends)) {
      result.extends.push(listItem[1].trim());
    } else if (listItem && result.extends === undefined) {
      result.extends = [listItem[1].trim()];
    }
  }

  private static parseYamlRuleLine(line: string, result: CommitLintConfig): void {
    const ruleMatch = /^[ \t]+([a-z][a-z-]+):\s*(\[.+\])\s*(?:#.*)?$/.exec(line);
    if (!ruleMatch) { return; }
    try {
      // Quote unquoted bare words so the flow sequence becomes valid JSON
      const json = ruleMatch[2]
        .replaceAll(/'/g, '"')
        .replaceAll(/([[\s,])([a-zA-Z][a-zA-Z0-9-]*)(?=[,\]\s])/g, '$1"$2"');
      result.rules[ruleMatch[1]] = JSON.parse(json);
    } catch { /* skip malformed rule */ }
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
        const jsConfig = this.requireJsConfig(configPath);
        return jsConfig ? this.mergePresets(jsConfig, configPath, visited) : {};
      }

      return this.loadTextConfig(configPath, ext, visited);
    } catch (error) {
      Logger.log(`CommitLint: failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  }

  /**
   * `require`s a `.js`/`.cjs` config. Returns null (no rules) for untrusted
   * workspaces and ESM modules; re-throws unexpected require errors.
   */
  private static requireJsConfig(configPath: string): CommitLintConfig | null {
    if (!vscode.workspace.isTrusted) {
      Logger.warn(`CommitLint: skipping JS config in untrusted workspace: ${configPath}`);
      return null;
    }
    const req = createRequire(configPath);
    let mod: CommitLintConfig & { default?: CommitLintConfig };
    try {
      mod = req(configPath) as CommitLintConfig & { default?: CommitLintConfig };
    } catch (e: unknown) {
      if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ERR_REQUIRE_ESM') {
        Logger.warn(`CommitLint: ${path.basename(configPath)} uses ES module syntax — use a JSON or YAML config instead`);
        return null;
      }
      throw e;
    }
    return mod?.default ?? mod;
  }

  /** Parses YAML / JSON / extensionless config content (with a YAML fallback). */
  private static loadTextConfig(configPath: string, ext: string, visited: Set<string>): CommitLintRules {
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
  }

  private static caseStr(v: unknown): string {
    if (Array.isArray(v)) { return v.map(c => CASE_LABELS[c as string] ?? String(c)).join(', '); }
    return CASE_LABELS[v as string] ?? String(v);
  }

  private static rulesToInstructions(rules: CommitLintRules, headerHint?: string): string {
    const lines: string[] = ['Commit message rules for this project:\n'];
    if (headerHint) { lines.push(`- ${headerHint}`); }

    this.appendTypeInstructions(rules, lines);
    this.appendScopeInstructions(rules, lines);
    this.appendSubjectInstructions(rules, lines);
    this.appendHeaderInstructions(rules, lines);
    this.appendBodyInstructions(rules, lines);
    this.appendFooterInstructions(rules, lines);
    this.appendTrailerInstructions(rules, lines);

    return lines.length > 1 ? lines.join('\n') : COMMIT_RULES_DEFAULT;
  }

  private static appendTypeInstructions(rules: CommitLintRules, lines: string[]): void {
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
  }

  private static appendScopeInstructions(rules: CommitLintRules, lines: string[]): void {
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
  }

  private static appendSubjectInstructions(rules: CommitLintRules, lines: string[]): void {
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
  }

  private static appendHeaderInstructions(rules: CommitLintRules, lines: string[]): void {
    if (rules['header-max-length']?.[2]) {
      lines.push(`- Header (first line) max length: ${rules['header-max-length'][2]} characters`);
    }
    if (rules['header-min-length']?.[2]) {
      lines.push(`- Header (first line) min length: ${rules['header-min-length'][2]} characters`);
    }
    if (rules['header-full-stop']?.[0] === 2 && rules['header-full-stop']?.[1] === 'never') {
      lines.push(`- Header must not end with "${rules['header-full-stop'][2] ?? '.'}"`);
    }
  }

  private static appendBodyInstructions(rules: CommitLintRules, lines: string[]): void {
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
  }

  private static appendFooterInstructions(rules: CommitLintRules, lines: string[]): void {
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
  }

  private static appendTrailerInstructions(rules: CommitLintRules, lines: string[]): void {
    for (const ruleName of ['signed-off-by', 'trailer-exists'] as const) {
      if (rules[ruleName]?.[0] === 2 && rules[ruleName]?.[1] === 'always') {
        lines.push(`- End the message with a "${rules[ruleName][2] ?? 'Signed-off-by:'}" trailer line`);
      }
    }
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

    const headerMatch = /^([a-zA-Z0-9_-]+)(?:\(([^)]*)\))?!?:\s*(.*)$/.exec(header);

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
    const parsed = this.parseCommitMessage(message);
    const ctx: RuleContext = { ...parsed, msgLines: message.split('\n') };

    for (const [ruleName, entry] of Object.entries(rules)) {
      if (entry?.[0] !== 2) { continue; }
      const condition = entry[1] as 'always' | 'never';
      const value     = entry[2];

      const error = this.evaluateRule(ruleName, condition, value, ctx);
      if (error) { errors.push(error); }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Dispatches a single rule to its category handler. Returns an error message or null. */
  private static evaluateRule(
    ruleName: string,
    condition: 'always' | 'never',
    value: unknown,
    ctx: RuleContext,
  ): string | null {
    const category = ruleName === 'signed-off-by' || ruleName === 'trailer-exists'
      ? 'trailer'
      : ruleName.split('-')[0];
    switch (category) {
      case 'type':    return this.checkTypeRule(ruleName, condition, value, ctx);
      case 'scope':   return this.checkScopeRule(ruleName, condition, value, ctx);
      case 'subject': return this.checkSubjectRule(ruleName, condition, value, ctx);
      case 'header':  return this.checkHeaderRule(ruleName, condition, value, ctx);
      case 'body':    return this.checkBodyRule(ruleName, condition, value, ctx);
      case 'footer':  return this.checkFooterRule(ruleName, condition, value, ctx);
      case 'trailer': return this.checkTrailerRule(condition, value, ctx);
      default:        return null;
    }
  }

  private static checkTypeRule(
    ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
  ): string | null {
    const { type } = ctx;
    switch (ruleName) {
      case 'type-enum': {
        const list = value as string[];
        if (type && (condition === 'never' ? list.includes(type) : !list.includes(type))) {
          return `type must ${condition === 'never' ? 'not ' : ''}be one of [${list.join(', ')}]`;
        }
        return null;
      }
      case 'type-case':
        if (type && !this.checkCase(type, value, condition)) {
          return `type must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`;
        }
        return null;
      case 'type-empty':
        if (condition === 'never' && isEmpty(type)) { return 'type may not be empty'; }
        if (condition === 'always' && !isEmpty(type)) { return 'type must be empty'; }
        return null;
      case 'type-max-length':
        return type.length > (value as number) ? `type must not be longer than ${value} characters` : null;
      case 'type-min-length':
        return type.length < (value as number) ? `type must not be shorter than ${value} characters` : null;
      default:
        return null;
    }
  }

  private static checkScopeRule(
    ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
  ): string | null {
    const { scope } = ctx;
    switch (ruleName) {
      case 'scope-enum': {
        const list = value as string[];
        if (scope === null || scope === '') { return null; }
        // commitlint allows multiple scopes delimited by "/", "\" or ","
        const scopes = scope.split(/[/,\\]/).map(s => s.trim()).filter(Boolean);
        const violates = condition === 'never'
          ? scopes.some(s => list.includes(s))
          : !scopes.every(s => list.includes(s));
        return violates ? `scope must ${condition === 'never' ? 'not ' : ''}be one of [${list.join(', ')}]` : null;
      }
      case 'scope-case':
        if (scope !== null && scope !== '' && !this.checkCase(scope, value, condition)) {
          return `scope must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`;
        }
        return null;
      case 'scope-empty':
        if (condition === 'never' && (scope === null || isEmpty(scope))) { return 'scope may not be empty'; }
        if (condition === 'always' && scope !== null && !isEmpty(scope)) { return 'scope must be empty'; }
        return null;
      case 'scope-max-length':
        return scope && scope.length > (value as number) ? `scope must not be longer than ${value} characters` : null;
      case 'scope-min-length':
        return scope && scope.length < (value as number) ? `scope must not be shorter than ${value} characters` : null;
      default:
        return null;
    }
  }

  private static checkSubjectRule(
    ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
  ): string | null {
    const { subject, header } = ctx;
    switch (ruleName) {
      case 'subject-case':
        if (subject && !this.checkCase(subject, value, condition)) {
          return `subject must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`;
        }
        return null;
      case 'subject-empty':
        return condition === 'never' && isEmpty(subject) ? 'subject may not be empty' : null;
      case 'subject-full-stop': {
        const stop = (value as string) ?? '.';
        if (condition === 'never' && subject.endsWith(stop)) { return `subject may not end with "${stop}"`; }
        if (condition === 'always' && !subject.endsWith(stop)) { return `subject must end with "${stop}"`; }
        return null;
      }
      case 'subject-max-length':
        return subject.length > (value as number) ? `subject must not be longer than ${value} characters` : null;
      case 'subject-min-length':
        return subject.length < (value as number) ? `subject must not be shorter than ${value} characters` : null;
      case 'subject-exclamation-mark': {
        const hasMark = /^[a-zA-Z0-9_-]+(?:\([^)]*\))?!:/.test(header);
        if (condition === 'never' && hasMark) { return 'subject must not have an exclamation mark before the ":" marker'; }
        if (condition === 'always' && !hasMark) { return 'subject must have an exclamation mark before the ":" marker'; }
        return null;
      }
      default:
        return null;
    }
  }

  private static checkHeaderRule(
    ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
  ): string | null {
    const { header } = ctx;
    switch (ruleName) {
      case 'header-max-length':
        return header.length > (value as number) ? `header must not be longer than ${value} characters` : null;
      case 'header-min-length':
        return header.length < (value as number) ? `header must not be shorter than ${value} characters` : null;
      case 'header-case':
        if (header && !this.checkCase(header, value, condition)) {
          return `header must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`;
        }
        return null;
      case 'header-full-stop': {
        const stop = (value as string) ?? '.';
        if (condition === 'never' && header.endsWith(stop)) { return `header may not end with "${stop}"`; }
        if (condition === 'always' && !header.endsWith(stop)) { return `header must end with "${stop}"`; }
        return null;
      }
      case 'header-trim':
        return header !== header.trim() ? 'header must not have leading or trailing whitespace' : null;
      default:
        return null;
    }
  }

  private static checkBodyRule(
    ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
  ): string | null {
    const { body, msgLines } = ctx;
    switch (ruleName) {
      case 'body-leading-blank':
        if (condition === 'always' && msgLines.length > 1 && msgLines[1].trim() !== '') {
          return 'body must have a leading blank line';
        }
        return null;
      case 'body-max-line-length':
        return body.split('\n').some(l => l.length > (value as number))
          ? `body line must not be longer than ${value} characters` : null;
      case 'body-max-length':
        return body.length > (value as number) ? `body must not be longer than ${value} characters` : null;
      case 'body-empty':
        return condition === 'never' && isEmpty(body) ? 'body may not be empty' : null;
      case 'body-min-length':
        return body.length < (value as number) ? `body must not be shorter than ${value} characters` : null;
      case 'body-case':
        if (body && !this.checkCase(body, value, condition)) {
          return `body must be ${condition === 'always' ? '' : 'not '}${this.caseStr(value)}`;
        }
        return null;
      case 'body-full-stop': {
        const stop = (value as string) ?? '.';
        if (body && condition === 'never' && body.endsWith(stop)) { return `body may not end with "${stop}"`; }
        if (body && condition === 'always' && !body.endsWith(stop)) { return `body must end with "${stop}"`; }
        return null;
      }
      default:
        return null;
    }
  }

  private static checkFooterRule(
    ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
  ): string | null {
    const { footer, msgLines } = ctx;
    switch (ruleName) {
      case 'footer-leading-blank': {
        if (condition === 'always' && footer) {
          const firstFooterLine = footer.split('\n')[0];
          const idx = msgLines.indexOf(firstFooterLine);
          if (idx > 0 && msgLines[idx - 1] !== '') {
            return 'footer must have a leading blank line';
          }
        }
        return null;
      }
      case 'footer-max-line-length':
        return footer.split('\n').some(l => l.length > (value as number))
          ? `footer line must not be longer than ${value} characters` : null;
      case 'footer-max-length':
        return footer.length > (value as number) ? `footer must not be longer than ${value} characters` : null;
      case 'footer-empty':
        return condition === 'never' && isEmpty(footer) ? 'footer may not be empty' : null;
      case 'footer-min-length':
        return footer.length < (value as number) ? `footer must not be shorter than ${value} characters` : null;
      default:
        return null;
    }
  }

  private static checkTrailerRule(
    condition: 'always' | 'never', value: unknown, ctx: RuleContext,
  ): string | null {
    const trailer = (value as string) ?? 'Signed-off-by:';
    const present = ctx.msgLines.some(l => l.startsWith(trailer));
    if (condition === 'always' && !present) { return `message must contain a "${trailer}" trailer`; }
    if (condition === 'never' && present) { return `message must not contain a "${trailer}" trailer`; }
    return null;
  }
}

export { CommitLintService };
