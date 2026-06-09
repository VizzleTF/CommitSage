/* eslint-disable @typescript-eslint/no-explicit-any */
import * as path from 'path';
import * as fs from 'fs';

import { Logger } from '../utils/logger';

import { CommitLintError, CommitLintResult } from '../models/types';

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

class CommitLintService {
  private static commitLintLoadModule: any = null;
  private static commitLintLintModule: any = null;

  private static configFiles = [
    '.commitlintrc',
    '.commitlintrc.json',
    '.commitlintrc.js',
    '.commitlintrc.cjs',
    'commitlint.config.js',
    'commitlint.config.cjs',
    '.commitlintrc.yml',
    '.commitlintrc.yaml',
  ];

  private static async getCommitLintLoad(): Promise<any> {
    if (!CommitLintService.commitLintLoadModule) {
      CommitLintService.commitLintLoadModule = await import('@commitlint/load');
    }
    return CommitLintService.commitLintLoadModule.default;
  }

  private static async getCommitLintLint(): Promise<any> {
    if (!CommitLintService.commitLintLintModule) {
      CommitLintService.commitLintLintModule = await import('@commitlint/lint');
    }
    return CommitLintService.commitLintLintModule.default;
  }

  private static resolveCwd(repoPath: string, rulesPath?: string): string {
    if (!rulesPath) {
      return repoPath;
    }
    return path.isAbsolute(rulesPath) ? rulesPath : path.join(repoPath, rulesPath);
  }

  static async extractRules(repoPath: string, rulesPath?: string): Promise<string> {
    try {
      const load = await this.getCommitLintLoad();
      const cwd = this.resolveCwd(repoPath, rulesPath);
      const config = await load({ cwd });

      const rules = config?.rules ?? {};
      if (Object.keys(rules).length === 0) {
        Logger.log('No commitlint rules found, using defaults');
        return COMMIT_RULES_DEFAULT;
      }

      let rulesText = 'CommitLint rules for this project:\n\n';
      let rulesFound = false;

      if (rules['type-enum']?.[2]?.length) {
        rulesText += `- Allowed types: ${(rules['type-enum'][2] as string[]).join(', ')}\n`;
        rulesFound = true;
      }

      if (rules['subject-case']?.[2]) {
        const cases = Array.isArray(rules['subject-case'][2])
          ? (rules['subject-case'][2] as string[]).join(', ')
          : String(rules['subject-case'][2]);
        rulesText += `- Subject case: ${cases}\n`;
        rulesFound = true;
      }

      if (rules['subject-empty']?.[0] === 2) {
        rulesText += '- Subject cannot be empty\n';
        rulesFound = true;
      }

      if (rules['subject-max-length']?.[2]) {
        rulesText += `- Subject max length: ${rules['subject-max-length'][2]} characters\n`;
        rulesFound = true;
      }

      if (rules['scope-empty']?.[0] === 2) {
        rulesText += '- Scope is required\n';
        rulesFound = true;
      }

      if (rules['body-max-line-length']?.[2]) {
        rulesText += `- Body max line length: ${rules['body-max-line-length'][2]} characters\n`;
        rulesFound = true;
      }

      return rulesFound ? rulesText : COMMIT_RULES_DEFAULT;
    } catch (error) {
      Logger.log(`Error extracting commitlint rules: ${error instanceof Error ? error.message : String(error)}`);
      return COMMIT_RULES_DEFAULT;
    }
  }

  static hasConfig(repoPath: string): boolean {
    return this.configFiles.some(file => fs.existsSync(path.join(repoPath, file)));
  }

  static async validate(message: string, repoPath: string, rulesPath?: string): Promise<CommitLintResult> {
    try {
      if (!this.hasConfig(repoPath)) {
        return { valid: true, errors: [] };
      }

      const load = await this.getCommitLintLoad();
      const lint = await this.getCommitLintLint();
      const cwd = this.resolveCwd(repoPath, rulesPath);
      const config = await load({ cwd });
      const report = await lint(message, config.rules, { parserOpts: config.parserPreset?.parserOpts });

      return {
        valid: report.valid,
        errors: report.errors.map((e: CommitLintError) => e.message),
      };
    } catch (error) {
      Logger.log(`CommitLint validation error: ${error instanceof Error ? error.message : String(error)}`);
      return { valid: true, errors: [] };
    }
  }
}

export { CommitLintService };
