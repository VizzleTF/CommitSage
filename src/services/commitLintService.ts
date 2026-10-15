import { Logger } from '../utils/logger';

import { CommitLintCliService } from './commitLintCliService';
import { FORMAT_RULE_SETS, FormatRuleSet } from './formatRules';
import { COMMITLINT_COMPATIBLE_FORMATS, CONFIG_DRIVEN_FORMATS } from '../utils/constants';
import * as vscode from 'vscode';
import { CommitLintResult } from '../models/types';
import { UserCancelledError } from '../models/errors';
import { toError } from '../utils/errorUtils';

import { resolveConfigPath, loadConfig } from './commitlint/configLoader';
import { rulesToInstructions, COMMIT_RULES_DEFAULT } from './commitlint/ruleInstructions';
import { validateWithRuleSet } from './commitlint/ruleValidator';
import { applyAutoFixes } from './commitlint/autoFix';

/**
 * project — the repo's own commitlint CLI (full CI parity; falls back to builtin when unavailable);
 * builtin — the bundled static engine with per-format rule sets.
 */
export type CommitLintEngine = 'project' | 'builtin';

// "always" errors of `signed-off-by` / `trailer-exists` on Signed-off-by, from
// the builtin engine ('must contain a "Signed-off-by:" trailer') and the CLI
// ('must be signed off', 'must have `Signed-off-by:` trailer').
const SIGN_OFF_REQUIRED = /^message must (?:be signed off|(?:contain a|have) .signed-off-by\b)/i;

/**
 * A sign-off certifies the human author, so the model never writes one and a
 * rule requiring it must not trigger refinement. The flag lets autoCommit
 * commit with `--signoff`, where git adds the real identity.
 */
function withoutSignOffErrors(result: CommitLintResult): CommitLintResult {
  const errors = result.errors.filter(e => !SIGN_OFF_REQUIRED.test(e));
  if (errors.length === result.errors.length) { return result; }
  return { valid: errors.length === 0, errors, signOffRequired: true };
}

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
  /**
   * Runs `run` on the project CLI when that engine is selected and usable.
   * Null means "fall back to builtin"; a cancelled run aborts instead: the CLI
   * is killed on abort, and that is indistinguishable from "no usable CLI" by
   * exit code alone.
   */
  private static async viaProject<T>(
    opts: CommitLintOptions, format: string, what: string, run: () => Promise<T | null>,
  ): Promise<T | null> {
    if (opts.engine !== 'project' || !vscode.workspace.isTrusted || !COMMITLINT_COMPATIBLE_FORMATS.has(format)) {
      return null;
    }
    try {
      const result = await run();
      if (result) { return result; }
    } catch (error) {
      if (error instanceof UserCancelledError) {
        throw error;
      }
      Logger.log(`CommitLint: project CLI ${what} failed: ${toError(error).message}`);
    }
    Logger.warn(`CommitLint: project engine requested but commitlint CLI is unavailable — using builtin ${what}`);
    return null;
  }

  /**
   * The builtin rule set for a format. conventional/angular read the repo's
   * commitlint config when one is found and yields rules; every other format
   * (and those two without a config) uses its static set.
   */
  private static builtinRuleSet(format: string, repoPath: string, rulesPath?: string): FormatRuleSet | undefined {
    if (CONFIG_DRIVEN_FORMATS.has(format)) {
      const configPath = resolveConfigPath(repoPath, rulesPath);
      const rules = configPath ? loadConfig(configPath) : {};
      if (Object.keys(rules).length > 0) { return { rules }; }
    }
    return FORMAT_RULE_SETS[format];
  }

  static async extractRules(repoPath: string, rulesPath?: string, opts: CommitLintOptions = {}): Promise<string> {
    const format = opts.format ?? 'conventional';
    // Fully resolved rules: extends chains, community presets and plugins
    // are already applied by the project's own commitlint.
    const resolved = await this.viaProject(opts, format, 'rule extraction',
      () => CommitLintCliService.resolvedRules(repoPath, rulesPath, opts.signal));
    if (resolved) {
      Logger.log(`CommitLint: prompt rules from project CLI (${Object.keys(resolved).length} resolved rules)`);
      return rulesToInstructions(resolved);
    }
    try {
      const ruleSet = this.builtinRuleSet(format, repoPath, rulesPath);
      return ruleSet ? rulesToInstructions(ruleSet.rules, ruleSet.headerHint) : COMMIT_RULES_DEFAULT;
    } catch (error) {
      Logger.log(`CommitLint: error extracting rules: ${toError(error).message}`);
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
    const cliResult = await this.viaProject(opts, format, 'validator',
      () => CommitLintCliService.validate(message, repoPath, rulesPath, opts.signal));
    const result = withoutSignOffErrors(cliResult ?? this.validateBuiltin(message, repoPath, rulesPath, format));
    const verdict = result.valid ? 'valid' : `invalid (${result.errors.length} errors: ${result.errors.join('; ')})`;
    Logger.log(`CommitLint: ${cliResult ? 'project CLI verdict' : `builtin verdict (${format})`} — ${verdict}`);
    return result;
  }

  private static validateBuiltin(message: string, repoPath: string, rulesPath: string | undefined, format: string): CommitLintResult {
    try {
      const ruleSet = this.builtinRuleSet(format, repoPath, rulesPath);
      return ruleSet ? validateWithRuleSet(message, ruleSet) : { valid: true, errors: [] };
    } catch (error) {
      Logger.log(`CommitLint: validation error: ${toError(error).message}`);
      return { valid: true, errors: [] };
    }
  }

  static autoFix(message: string, repoPath: string, rulesPath?: string, format = 'conventional'): string {
    try {
      const ruleSet = this.builtinRuleSet(format, repoPath, rulesPath);
      // Emoji-prefixed and structural formats are left to the LLM refinement
      // loop — mechanical header fixes assume a conventional-shaped header.
      if (!ruleSet || ruleSet.stripPrefix || ruleSet.structural) { return message; }
      return applyAutoFixes(message, ruleSet.rules);
    } catch (error) {
      Logger.log(`CommitLint: autofix error: ${toError(error).message}`);
      return message;
    }
  }
}

export { CommitLintService };
