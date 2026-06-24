/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import * as vscode from 'vscode';

import { Logger } from '../../utils/logger';
import { FORMAT_RULE_SETS } from '../formatRules';
import { CommitLintConfig, CommitLintRules } from '../../models/types';

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

// The two presets commitlint ships are exactly the conventional/angular rule
// sets we already maintain in formatRules — reuse them instead of keeping a
// second hand-copied table that can drift.
const KNOWN_PRESETS: Record<string, CommitLintRules> = {
  '@commitlint/config-conventional': FORMAT_RULE_SETS.conventional.rules,
  '@commitlint/config-angular':      FORMAT_RULE_SETS.angular.rules,
};

function packageJsonHasConfig(repoPath: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8');
    return (JSON.parse(raw) as { commitlint?: unknown }).commitlint !== undefined;
  } catch {
    return false;
  }
}

export function hasConfig(repoPath: string): boolean {
  return packageJsonHasConfig(repoPath)
    || CONFIG_FILES.some(file => fs.existsSync(path.join(repoPath, file)));
}

export function resolveConfigPath(repoPath: string, rulesPath?: string): string | null {
  if (rulesPath && rulesPath !== '.') {
    const abs = path.isAbsolute(rulesPath) ? rulesPath : path.join(repoPath, rulesPath);
    try {
      return fs.statSync(abs).isFile() ? abs : null;
    } catch {
      return null;
    }
  }
  // package.json first to match cosmiconfig's search order
  if (packageJsonHasConfig(repoPath)) {
    return path.join(repoPath, 'package.json');
  }
  for (const file of CONFIG_FILES) {
    const abs = path.join(repoPath, file);
    if (fs.existsSync(abs)) { return abs; }
  }
  return null;
}

function mergePresets(config: CommitLintConfig, configPath: string, visited: Set<string>): CommitLintRules {
  let presetNames: string[] = [];
  if (config.extends) {
    presetNames = Array.isArray(config.extends) ? config.extends : [config.extends];
  }

  const merged: CommitLintRules = {};
  for (const name of presetNames) {
    if (KNOWN_PRESETS[name]) {
      Object.assign(merged, KNOWN_PRESETS[name]);
    } else if (name.startsWith('.')) {
      Object.assign(merged, loadLocalExtends(name, configPath, visited));
    } else {
      Logger.warn(`CommitLint: unknown preset "${name}" — only config-conventional and config-angular are built-in; its rules are ignored`);
    }
  }
  Object.assign(merged, config.rules ?? {});
  return merged;
}

/** Resolves `extends: "./base"` relative to the extending config, like commitlint does. */
function loadLocalExtends(name: string, configPath: string, visited: Set<string>): CommitLintRules {
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
    return loadConfig(candidate, visited);
  }
  Logger.warn(`CommitLint: local extends "${name}" not found next to ${path.basename(configPath)}`);
  return {};
}

function parseYamlConfig(content: string): CommitLintConfig {
  const result: CommitLintConfig = { rules: {} };
  const lines = content.split('\n');
  let inRules = false;

  for (const line of lines) {
    // detect top-level section changes
    if (/^\S/.test(line)) {
      inRules = /^rules\s*:/.test(line);
    }

    parseYamlExtendsLine(line, inRules, result);

    // rule line (only inside rules: section)  →    type-enum: [2, always, [feat, fix]]
    if (inRules) {
      parseYamlRuleLine(line, result);
    }
  }

  return result;
}

function parseYamlExtendsLine(line: string, inRules: boolean, result: CommitLintConfig): void {
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

function parseYamlRuleLine(line: string, result: CommitLintConfig): void {
  const ruleMatch = /^[ \t]+([a-z][a-z-]+):\s*(\[.+\])\s*(?:#.*)?$/.exec(line);
  if (!ruleMatch) { return; }
  try {
    // Quote unquoted bare words so the flow sequence becomes valid JSON
    const json = ruleMatch[2]
      .replaceAll("'", '"')
      .replaceAll(/([[\s,])([a-zA-Z][a-zA-Z0-9-]*)(?=[,\]\s])/g, '$1"$2"');
    result.rules[ruleMatch[1]] = JSON.parse(json);
  } catch { /* skip malformed rule */ }
}

/**
 * `require`s a `.js`/`.cjs` config. Returns null (no rules) for untrusted
 * workspaces and ESM modules; re-throws unexpected require errors.
 */
function requireJsConfig(configPath: string): CommitLintConfig | null {
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
function loadTextConfig(configPath: string, ext: string, visited: Set<string>): CommitLintRules {
  const content = fs.readFileSync(configPath, 'utf8');

  if (ext === '.yml' || ext === '.yaml') {
    return mergePresets(parseYamlConfig(content), configPath, visited);
  }

  // .json — and extensionless .commitlintrc, which cosmiconfig parses as
  // JSON or YAML; mirror that with a YAML fallback.
  try {
    return mergePresets(JSON.parse(content) as CommitLintConfig, configPath, visited);
  } catch (jsonError) {
    if (ext === '') {
      return mergePresets(parseYamlConfig(content), configPath, visited);
    }
    throw jsonError;
  }
}

export function loadConfig(configPath: string, visited: Set<string> = new Set()): CommitLintRules {
  const ext = path.extname(configPath).toLowerCase();
  visited.add(configPath);
  try {
    if (path.basename(configPath) === 'package.json') {
      const pkg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { commitlint?: CommitLintConfig };
      return pkg.commitlint ? mergePresets(pkg.commitlint, configPath, visited) : {};
    }

    if (ext === '.mjs' || ext === '.ts') {
      Logger.warn(`CommitLint: ${path.basename(configPath)} is not supported (ESM/TypeScript) — use a JSON or YAML config instead`);
      return {};
    }

    if (ext === '.js' || ext === '.cjs') {
      const jsConfig = requireJsConfig(configPath);
      return jsConfig ? mergePresets(jsConfig, configPath, visited) : {};
    }

    return loadTextConfig(configPath, ext, visited);
  } catch (error) {
    Logger.log(`CommitLint: failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}
