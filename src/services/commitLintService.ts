/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

import { Logger } from '../utils/logger';

import { CommitLintConfig, CommitLintRules, CommitLintResult, ParsedCommit } from '../models/types';

const CONFIG_FILES = [
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  'commitlint.config.js',
  'commitlint.config.cjs',
  '.commitlintrc.yml',
  '.commitlintrc.yaml',
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
};
KNOWN_PRESETS['@commitlint/config-angular'] = KNOWN_PRESETS['@commitlint/config-conventional'];

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
    return this.configFiles.some(file => fs.existsSync(path.join(repoPath, file)));
  }

  private static resolveConfigPath(repoPath: string, rulesPath?: string): string | null {
    if (rulesPath) {
      const abs = path.isAbsolute(rulesPath) ? rulesPath : path.join(repoPath, rulesPath);
      return fs.existsSync(abs) ? abs : null;
    }
    for (const file of this.configFiles) {
      const abs = path.join(repoPath, file);
      if (fs.existsSync(abs)) { return abs; }
    }
    return null;
  }

  static extractRules(repoPath: string, rulesPath?: string): string {
    try {
      const configPath = this.resolveConfigPath(repoPath, rulesPath);
      if (!configPath) {
        Logger.log('CommitLint: no config found, using defaults');
        return COMMIT_RULES_DEFAULT;
      }
      const rules = this.loadConfig(configPath);
      if (Object.keys(rules).length === 0) {
        Logger.log('CommitLint: no rules found, using defaults');
        return COMMIT_RULES_DEFAULT;
      }
      return this.rulesToInstructions(rules);
    } catch (error) {
      Logger.log(`CommitLint: error extracting rules: ${error instanceof Error ? error.message : String(error)}`);
      return COMMIT_RULES_DEFAULT;
    }
  }

  static validate(message: string, repoPath: string, rulesPath?: string): CommitLintResult {
    try {
      if (!this.hasConfig(repoPath)) { return { valid: true, errors: [] }; }
      const configPath = this.resolveConfigPath(repoPath, rulesPath);
      if (!configPath) { return { valid: true, errors: [] }; }
      return this.validateCommit(message, this.loadConfig(configPath));
    } catch (error) {
      Logger.log(`CommitLint: validation error: ${error instanceof Error ? error.message : String(error)}`);
      return { valid: true, errors: [] };
    }
  }

  // ── Config parsing ───────────────────────────────────────────────────────

  private static mergePresets(config: CommitLintConfig): CommitLintRules {
    const presetNames = config.extends
      ? (Array.isArray(config.extends) ? config.extends : [config.extends])
      : [];

    const merged: CommitLintRules = {};
    for (const name of presetNames) {
      if (KNOWN_PRESETS[name]) { Object.assign(merged, KNOWN_PRESETS[name]); }
    }
    Object.assign(merged, config.rules ?? {});
    return merged;
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

  private static loadConfig(configPath: string): CommitLintRules {
    const ext = path.extname(configPath).toLowerCase();
    try {
      if (ext === '.js' || ext === '.cjs') {
        const req = createRequire(configPath);
        const mod = req(configPath) as CommitLintConfig & { default?: CommitLintConfig };
        return this.mergePresets(mod?.default ?? mod);
      }

      const content = fs.readFileSync(configPath, 'utf8');

      if (ext === '.yml' || ext === '.yaml') {
        return this.mergePresets(this.parseYamlConfig(content));
      }

      return this.mergePresets(JSON.parse(content) as CommitLintConfig);
    } catch (error) {
      Logger.log(`CommitLint: failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  }

  private static caseStr(v: unknown): string {
    if (Array.isArray(v)) { return v.map(c => CASE_LABELS[c as string] ?? String(c)).join(', '); }
    return CASE_LABELS[v as string] ?? String(v);
  }

  private static rulesToInstructions(rules: CommitLintRules): string {
    const lines: string[] = ['CommitLint rules for this project:\n'];

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

    // header
    if (rules['header-max-length']?.[2]) {
      lines.push(`- Header (first line) max length: ${rules['header-max-length'][2]} characters`);
    }
    if (rules['header-min-length']?.[2]) {
      lines.push(`- Header (first line) min length: ${rules['header-min-length'][2]} characters`);
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

    return lines.length > 1 ? lines.join('\n') : COMMIT_RULES_DEFAULT;
  }

  private static parseCommitMessage(message: string): ParsedCommit {
    const lines = message.split('\n');
    const header = lines[0] ?? '';

    let bodyStart = -1;
    let footerStart = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        if (bodyStart === -1) { bodyStart = i + 1; }
        else if (footerStart === -1) { footerStart = i + 1; }
      }
    }

    const body = bodyStart > 0
      ? lines.slice(bodyStart, footerStart > 0 ? footerStart - 1 : undefined).join('\n').trim()
      : '';
    const footer = footerStart > 0
      ? lines.slice(footerStart).join('\n').trim()
      : '';

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
        case 'type-enum':
          if (type && !(value as string[]).includes(type)) {
            errors.push(`type must be one of [${(value as string[]).join(', ')}]`);
          }
          break;
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
        case 'scope-enum':
          if (scope !== null && !(value as string[]).includes(scope)) {
            errors.push(`scope must be one of [${(value as string[]).join(', ')}]`);
          }
          break;
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

        // header
        case 'header-max-length':
          if (header.length > (value as number)) { errors.push(`header must not be longer than ${value} characters`); }
          break;
        case 'header-min-length':
          if (header.length < (value as number)) { errors.push(`header must not be shorter than ${value} characters`); }
          break;

        // body
        case 'body-leading-blank':
          if (condition === 'always' && body && msgLines[1] !== '') {
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
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

export { CommitLintService };
