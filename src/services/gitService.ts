import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { NoChangesDetectedError } from '../models/errors';
import { TelemetryService } from './telemetryService';
import { toError, sanitizeErrorForTelemetry } from '../utils/errorUtils';
import { unquoteGitPath } from '../utils/gitPath';
import { mapLimit } from '../utils/concurrency';
import { GitProcessRunner } from './gitProcessRunner';
import { GitRepositoryProvider } from './gitRepository';

const GIT_FANOUT_CONCURRENCY = 8;

const GIT_STATUS_CODES = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: '??',
  submodule: 'S',
} as const;

type GitStatusCode = (typeof GIT_STATUS_CODES)[keyof typeof GIT_STATUS_CODES];

const STAGED_STATUS_CODES: Set<GitStatusCode> = new Set([
  GIT_STATUS_CODES.modified,
  GIT_STATUS_CODES.added,
  GIT_STATUS_CODES.deleted,
  GIT_STATUS_CODES.renamed,
]);

export class GitService {
  static async initialize(): Promise<void> {
    try {
      Logger.log('Initializing Git service');
      await this.validateGitExtension();
      Logger.log('Git service initialized successfully');
    } catch (error) {
      Logger.error('Failed to initialize Git service:', toError(error));
      throw error;
    }
  }

  static async commitChanges(
    message: string,
    repository?: vscode.SourceControl,
  ): Promise<void> {
    try {
      const repo = repository || (await this.getActiveRepository());
      /* v8 ignore next -- optional-chaining artifact: `?.` short-circuit on a
         nullish repo is unreachable (getActiveRepository never returns nullish);
         the throw itself is covered. */
      if (!repo?.rootUri) {
        throw new Error('No active repository found');
      }

      const repoPath = repo.rootUri.fsPath;
      const hasStagedChanges = await this.hasChanges(repoPath, 'staged');
      const hasUntrackedFiles = await this.hasChanges(repoPath, 'untracked');
      const hasDeletedFiles = await this.hasChanges(repoPath, 'deleted');

      if (!hasStagedChanges && !hasUntrackedFiles && !hasDeletedFiles) {
        throw new NoChangesDetectedError();
      }

      if ((hasUntrackedFiles || hasDeletedFiles) && !hasStagedChanges) {
        await this.stageUntrackedAndDeleted(
          repoPath,
          hasUntrackedFiles,
          hasDeletedFiles,
        );
      }

      await this.executeGitCommand(['commit', '-m', message], repoPath);
      Logger.log('Changes committed successfully');

      TelemetryService.sendEvent({
        name: 'commit_completed',
        hasStaged: hasStagedChanges,
        hasUntracked: hasUntrackedFiles,
        hasDeleted: hasDeletedFiles,
        messageLength: message.length,
      });
    } catch (error) {
      TelemetryService.sendEvent({
        name: 'commit_failed',
        ...sanitizeErrorForTelemetry(toError(error)),
      });
      Logger.error('Failed to commit changes:', toError(error));
      throw error;
    }
  }

  private static async hasRemotes(repoPath: string): Promise<boolean> {
    try {
      const result = await this.executeGitCommand(['remote'], repoPath);
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  static async pushChanges(repository?: vscode.SourceControl): Promise<void> {
    try {
      const repo = repository || (await this.getActiveRepository());
      /* v8 ignore next -- optional-chaining artifact: `?.` short-circuit on a
         nullish repo is unreachable (getActiveRepository never returns nullish);
         the throw itself is covered. */
      if (!repo?.rootUri) {
        throw new Error('No active repository found');
      }

      const repoPath = repo.rootUri.fsPath;
      if (!(await this.hasRemotes(repoPath))) {
        throw new Error(
          'Repository has no configured remotes. Please add a remote repository using git remote add <name> <url>',
        );
      }

      await this.executeGitCommand(['push'], repoPath);
      TelemetryService.sendEvent({ name: 'push_completed' });
    } catch (error) {
      Logger.error('Failed to push changes:', toError(error));
      TelemetryService.sendEvent({
        name: 'push_failed',
        ...sanitizeErrorForTelemetry(toError(error)),
      });
      throw error;
    }
  }

  /**
   * Run a git command that prints one path per line and return the non-empty,
   * git-unquoted paths. The single home for the
   * `split('\n').filter(...).map(unquoteGitPath)` pipeline that used to be
   * copy-pasted across staging, per-file diffing, and change detection.
   */
  private static async listFiles(
    listArgs: string[],
    repoPath: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const output = await this.executeGitCommand(listArgs, repoPath, signal);
    return output
      .split('\n')
      .filter((file) => file.trim())
      .map(unquoteGitPath);
  }

  /**
   * Stage every untracked and/or deleted file so a "nothing staged yet" commit
   * still captures them. Extracted from `commitChanges`; reuses `listFiles` for
   * the same enumeration `hasChanges` performed.
   */
  private static async stageUntrackedAndDeleted(
    repoPath: string,
    hasUntrackedFiles: boolean,
    hasDeletedFiles: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const filesToStage: string[] = [];
    if (hasUntrackedFiles) {
      filesToStage.push(
        ...(await this.listFiles(['ls-files', '--others', '--exclude-standard'], repoPath, signal)),
      );
    }
    if (hasDeletedFiles) {
      filesToStage.push(
        ...(await this.listFiles(['ls-files', '--deleted'], repoPath, signal)),
      );
    }
    /* v8 ignore next -- the empty branch is unreachable: filesToStage is
       populated by the same git ls-files command (+ same filter) that
       hasChanges() used to decide we get here, so it's always non-empty. */
    if (filesToStage.length > 0) {
      await this.executeGitCommand(['add', '--', ...filesToStage], repoPath, signal);
    }
  }

  /**
   * Fan out `perFileDiff` over `files` (bounded concurrency), drop blank
   * results, and prefix the surviving diffs with `header` — or return '' when
   * none survive. Shared by `getUntrackedDiff` and `getDeletedDiff`, which
   * differ only in the per-file git command.
   */
  private static async collectPerFileDiffs(
    files: string[],
    header: string,
    perFileDiff: (file: string) => Promise<string>,
    signal?: AbortSignal,
  ): Promise<string> {
    const diffs = await mapLimit(files, GIT_FANOUT_CONCURRENCY, perFileDiff, signal);
    const validDiffs = diffs.filter((diff) => diff.trim());
    return validDiffs.length > 0 ? header + validDiffs.join('\n') : '';
  }

  /**
   * Enumerate the files that changed, by category, in a single pass. Each
   * category is listed at most once and the list is reused for both the
   * "are there changes?" decision and the subsequent per-file diffing — the
   * old `detectChanges` + `collectDiffs` split listed every category twice
   * (once via `hasChanges`, once via the diff collectors). The same git
   * commands run, so the resulting diff is byte-for-byte identical; only the
   * redundant second enumeration is gone.
   *
   * Category gating matches the previous behavior exactly: untracked/deleted
   * surface only when there are no staged changes, deleted only when HEAD
   * exists, and nothing but staged is collected in `onlyStagedChanges` mode.
   */
  private static async enumerateChanges(
    repoPath: string,
    onlyStagedChanges: boolean,
    knownHasStagedChanges: boolean | undefined,
    signal?: AbortSignal,
  ): Promise<{
    staged: string[];
    unstaged: string[];
    untracked: string[];
    deleted: string[];
  }> {
    const hasHead = await this.hasHead(repoPath, signal);
    const staged = await this.listFiles(['diff', '--cached', '--name-only'], repoPath, signal);
    const hasStagedChanges = knownHasStagedChanges ?? staged.length > 0;

    const unstaged = onlyStagedChanges
      ? []
      : await this.listFiles(['diff', '--name-only'], repoPath, signal);
    const untracked = !onlyStagedChanges && !hasStagedChanges
      ? await this.listFiles(['ls-files', '--others', '--exclude-standard'], repoPath, signal)
      : [];
    const deleted = hasHead && !onlyStagedChanges && !hasStagedChanges
      ? await this.listFiles(['ls-files', '--deleted'], repoPath, signal)
      : [];

    return { staged, unstaged, untracked, deleted };
  }

  private static async collectDiffs(
    repoPath: string,
    changes: {
      staged: string[];
      unstaged: string[];
      untracked: string[];
      deleted: string[];
    },
    signal?: AbortSignal,
  ): Promise<string[]> {
    const diffs: string[] = [];

    if (changes.staged.length > 0) {
      diffs.push(...await this.diffFiles(changes.staged, repoPath, ['diff', '--cached'], '# Staged changes:\n', signal));
    }

    if (changes.unstaged.length > 0) {
      diffs.push(...await this.diffFiles(changes.unstaged, repoPath, ['diff'], '# Unstaged changes:\n', signal));
    }

    if (changes.untracked.length > 0) {
      const untracked = await this.getUntrackedDiff(changes.untracked, repoPath, signal);
      if (untracked) {
        diffs.push(untracked);
      }
    }

    if (changes.deleted.length > 0) {
      const deleted = await this.getDeletedDiff(changes.deleted, repoPath, signal);
      if (deleted) {
        diffs.push(deleted);
      }
    }

    return diffs;
  }

  static async getDiff(
    repoPath: string,
    onlyStagedChanges: boolean,
    knownHasStagedChanges?: boolean,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const changes = await this.enumerateChanges(
        repoPath,
        onlyStagedChanges,
        knownHasStagedChanges,
        signal,
      );

      if (
        changes.staged.length === 0 &&
        changes.unstaged.length === 0 &&
        changes.untracked.length === 0 &&
        changes.deleted.length === 0
      ) {
        throw new NoChangesDetectedError();
      }

      if (onlyStagedChanges && changes.staged.length > 0) {
        const staged = await this.diffFiles(changes.staged, repoPath, ['diff', '--cached'], undefined, signal);
        return staged.join('\n\n').trim();
      }

      const diffs = await this.collectDiffs(repoPath, changes, signal);

      const combinedDiff = diffs.join('\n\n').trim();
      if (!combinedDiff) {
        throw new NoChangesDetectedError();
      }

      return combinedDiff;
    } catch (error) {
      if (error instanceof NoChangesDetectedError) {
        throw error;
      }
      const original = toError(error);
      Logger.error('Error getting diff:', original);
      // Re-throw with the prefix prepended but preserve the original
      // constructor name and stack so telemetry buckets stay meaningful
      // (callers read `error.constructor.name` for `errorType`).
      original.message = `Failed to get diff: ${original.message}`;
      throw original;
    }
  }

  private static async isSubmodule(file: string, repoPath: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const { stdout } = await this.execGit(
        ['ls-files', '--stage', '--', file],
        repoPath,
        { signal },
      );
      return stdout.includes('160000');
    } catch {
      return false;
    }
  }

  /**
   * Diff each pre-enumerated file (bounded concurrency), skipping submodules
   * and blank diffs, prefixing surviving diffs with `prefix`. Takes the file
   * list as input — the caller already enumerated it in `enumerateChanges` —
   * instead of re-listing it here.
   */
  private static async diffFiles(
    files: string[],
    repoPath: string,
    diffArgs: string[],
    prefix?: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const results = await mapLimit(files, GIT_FANOUT_CONCURRENCY, async (file) => {
      if (await this.isSubmodule(file, repoPath, signal)) {
        return null;
      }
      const fileDiff = await this.executeGitCommand(
        [...diffArgs, '--', file],
        repoPath,
        signal,
      );
      if (!fileDiff.trim()) {
        return null;
      }
      return prefix ? prefix + fileDiff : fileDiff;
    }, signal);

    return results.filter((d): d is string => d !== null);
  }

  private static async getUntrackedDiff(files: string[], repoPath: string, signal?: AbortSignal): Promise<string> {
    return this.collectPerFileDiffs(files, '# New files:\n', async (file) => {
      try {
        // `git diff --no-index` always exits with 1 when the two inputs
        // differ (and 0 when they are identical), so we pass
        // allowNonZeroExit and use exitCode === 128 (or process error)
        // as the "real" failure signal.
        const { stdout, exitCode } = await this.execGit(
          ['diff', '--no-index', '--', '/dev/null', file],
          repoPath,
          { allowNonZeroExit: true, signal },
        );
        return exitCode === 128 ? '' : stdout;
      } catch (error) {
        Logger.error(`Error diffing untracked file ${file}:`, toError(error));
        return '';
      }
    }, signal);
  }

  private static async getDeletedDiff(files: string[], repoPath: string, signal?: AbortSignal): Promise<string> {
    return this.collectPerFileDiffs(files, '# Deleted files:\n', async (file) => {
      try {
        // git diff -- <file> on a deleted file (in the working tree) emits
        // a proper unified diff against HEAD. No manual header construction.
        return await this.executeGitCommand(['diff', '--', file], repoPath, signal);
      } catch (error) {
        Logger.error(`Error diffing deleted file ${file}:`, toError(error));
        return '';
      }
    }, signal);
  }

  public static async hasHead(repoPath: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.execGit(['rev-parse', 'HEAD'], repoPath, { signal });
      return true;
    } catch {
      return false;
    }
  }

  static async hasChanges(
    repoPath: string,
    type: 'staged' | 'unstaged' | 'untracked' | 'deleted',
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      let command: string[];
      switch (type) {
        case 'staged':
          command = ['diff', '--cached', '--name-only'];
          break;
        case 'unstaged':
          command = ['diff', '--name-only'];
          break;
        case 'untracked':
          command = ['ls-files', '--others', '--exclude-standard'];
          break;
        case 'deleted':
          command = ['ls-files', '--deleted'];
          break;
        default:
          throw new Error(`Invalid change type: ${type}`);
      }

      const output = await this.executeGitCommand(command, repoPath, signal);
      return output.trim().length > 0;
    } catch (error) {
      Logger.error(`Error checking for ${type} changes:`, toError(error));
      return false;
    }
  }

  static async getChangedFiles(
    repoPath: string,
    onlyStaged: boolean = false,
    signal?: AbortSignal,
  ): Promise<ChangedFile[]> {
    try {
      const statusCommand = ['status', '--porcelain'];
      const output = await this.executeGitCommand(statusCommand, repoPath, signal);

      return output
        .split('\n')
        .filter((line) => line.trim() !== '')
        .filter((line) => {
          if (onlyStaged) {
            return isStagedStatus(line);
          }
          // For all changes, check both staged and unstaged status
          const [staged, unstaged] = [line[0], line[1]];
          return staged !== ' ' || unstaged !== ' ';
        })
        .map((line) => {
          const status = line.substring(0, 2);
          let filePath = line.substring(3).trim();

          // Handle renamed files (they have format "R100 old-name -> new-name").
          // Fall back to the raw path if the ` -> ` separator is missing so we
          // never hand `undefined` to unquoteGitPath.
          if (status.startsWith('R')) {
            const renameParts = filePath.split(' -> ');
            filePath = renameParts[1] ?? renameParts[0];
          }

          // Unquote paths that git quoted due to spaces or special characters
          filePath = unquoteGitPath(filePath);

          return { path: filePath, status };
        });
    } catch (error) {
      Logger.error('Error getting changed files:', toError(error));
      return [];
    }
  }

  private static async executeGitCommand(
    args: string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const { stdout } = await this.execGit(args, cwd, { signal });
    return stdout;
  }

  static async getRepositories(): Promise<vscode.SourceControl[]> {
    return GitRepositoryProvider.getRepositories();
  }

  static async selectRepository(
    repos: vscode.SourceControl[],
  ): Promise<vscode.SourceControl> {
    return GitRepositoryProvider.selectRepository(repos);
  }

  static async getActiveRepository(
    sourceControlRepository?: vscode.SourceControl,
  ): Promise<vscode.SourceControl> {
    return GitRepositoryProvider.getActiveRepository(sourceControlRepository);
  }

  static async validateGitExtension(): Promise<void> {
    return GitRepositoryProvider.validateGitExtension();
  }

  /**
   * Runs a `git` subcommand and returns its raw stdout/stderr/exit code.
   * Thin delegate to {@link GitProcessRunner.execGit} — kept on `GitService`
   * because callers (and the blame analyzer) reach git through this facade.
   */
  public static async execGit(
    args: string[],
    cwd: string,
    options: { signal?: AbortSignal; allowNonZeroExit?: boolean } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return GitProcessRunner.execGit(args, cwd, options);
  }

}

/** Result of `getChangedFiles`. `status` is the raw 2-char `git status --porcelain` code. */
interface ChangedFile {
  path: string;
  status: string;
}

/**
 * Decode whether the porcelain status code corresponds to a deleted file.
 * Matches the git status semantics: 'D ' (staged delete), ' D' (unstaged delete).
 */
export function isDeletedStatus(status: string): boolean {
  return status === ' D' || status === 'D ';
}

/**
 * Decode whether the porcelain status code corresponds to a new (untracked or just-added) file.
 * Matches: '??' (untracked), 'A ' (staged add).
 */
export function isNewStatus(status: string): boolean {
  return status === '??' || status === 'A ';
}

/**
 * The index column (X) shows a change vs HEAD — i.e. the file is staged. Equals
 * the set `git diff --cached --name-only` would list (any index code that isn't
 * "unmodified" ' ' or "untracked" '?'), so deriving the staged flag from a
 * single `git status --porcelain` parse matches the old `hasChanges('staged')`
 * probe without a second git call.
 */
export function isIndexStaged(status: string): boolean {
  const x = status[0];
  return x !== ' ' && x !== '?';
}

/**
 * Whether the index column (X) is one of the staged codes the changed-files
 * list keys on (M/A/D/R). This is the same filter `getChangedFiles(_, true)`
 * applies, exposed so callers can derive the staged subset from an already
 * fetched all-changes list instead of re-running `git status`.
 */
export function isStagedStatus(status: string): boolean {
  return STAGED_STATUS_CODES.has(status[0] as GitStatusCode);
}
