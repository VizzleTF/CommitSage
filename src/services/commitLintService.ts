import { Logger } from '../utils/logger';

import { CommitLintCliService } from './commitLintCliService';
import { FORMAT_RULE_SETS, COMMITLINT_COMPATIBLE_FORMATS, CONFIG_DRIVEN_FORMATS } from './formatRules';
import * as vscode from 'vscode';
import { CommitLintResult, CommitLintRules } from '../models/types';

import { hasConfig as detectConfig, resolveConfigPath, loadConfig } from './commitlint/configLoader';
import { rulesToInstructions, COMMIT_RULES_DEFAULT } from './commitlint/ruleInstructions';
import { validateCommit, validateWithRuleSet } from './commitlint/ruleValidator';
import { applyAutoFixes } from './commitlint/autoFix';

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

/**
 * Facade over the commitlint engine. Orchestrates the project-CLI vs builtin
 * choice and delegates the real work to the `commitlint/` modules:
 *   configLoader      — discover + parse + resolve presets/extends
 *   ruleInstructions  — render rules into LLM prompt instructions
 *   ruleValidator     — validate a message against rules / a format rule set
 *   autoFix           — mechanical header fixes
 */
class CommitLintService {
  static hasConfig(repoPath: string): boolean {
    return detectConfig(repoPath);
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
          return rulesToInstructions(resolved);
        }
      } catch (error) {
        Logger.log(`CommitLint: project CLI rule extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      Logger.warn('CommitLint: project engine requested but commitlint CLI is unavailable — using builtin rule extraction');
    }
    return this.extractRulesBuiltin(repoPath, rulesPath, format);
  }

  /**
   * For config-driven formats (conventional/angular), resolves and loads the
   * repo's commitlint config, returning its rules — or null when the format
   * isn't config-driven, no config is found, or it yields no rules. Shared by
   * the builtin extract/validate/autofix paths.
   */
  private static loadConfigDrivenRules(format: string, repoPath: string, rulesPath?: string): CommitLintRules | null {
    if (!CONFIG_DRIVEN_FORMATS.has(format)) { return null; }
    const explicitPath = Boolean(rulesPath && rulesPath !== '.');
    const configPath = (explicitPath || detectConfig(repoPath))
      ? resolveConfigPath(repoPath, rulesPath)
      : null;
    if (!configPath) { return null; }
    const rules = loadConfig(configPath);
    return Object.keys(rules).length > 0 ? rules : null;
  }

  private static extractRulesBuiltin(repoPath: string, rulesPath: string | undefined, format: string): string {
    try {
      // conventional/angular read the repo's commitlint config when present;
      // every other format is checked against its own static rule set.
      const configRules = this.loadConfigDrivenRules(format, repoPath, rulesPath);
      if (configRules) { return rulesToInstructions(configRules); }

      const ruleSet = FORMAT_RULE_SETS[format];
      if (!ruleSet) { return COMMIT_RULES_DEFAULT; }
      return rulesToInstructions(ruleSet.rules, ruleSet.headerHint);
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
      const configRules = this.loadConfigDrivenRules(format, repoPath, rulesPath);
      if (configRules) { return validateCommit(message, configRules); }

      const ruleSet = FORMAT_RULE_SETS[format];
      if (!ruleSet) { return { valid: true, errors: [] }; }
      return validateWithRuleSet(message, ruleSet);
    } catch (error) {
      Logger.log(`CommitLint: validation error: ${error instanceof Error ? error.message : String(error)}`);
      return { valid: true, errors: [] };
    }
  }

  static autoFix(message: string, repoPath: string, rulesPath?: string, format = 'conventional'): string {
    try {
      const configRules = this.loadConfigDrivenRules(format, repoPath, rulesPath);
      if (configRules) { return applyAutoFixes(message, configRules); }

      const ruleSet = FORMAT_RULE_SETS[format];
      // Emoji-prefixed and structural formats are left to the LLM refinement
      // loop — mechanical header fixes assume a conventional-shaped header.
      if (!ruleSet || ruleSet.stripPrefix || ruleSet.structural) { return message; }
      return applyAutoFixes(message, ruleSet.rules);
    } catch (error) {
      Logger.log(`CommitLint: autofix error: ${error instanceof Error ? error.message : String(error)}`);
      return message;
    }
  }
}

export { CommitLintService };
