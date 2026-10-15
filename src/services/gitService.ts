import { Logger } from '../utils/logger';
import { NoChangesDetectedError } from '../models/errors';
import { TelemetryService } from './telemetryService';
import { toError, sanitizeErrorForTelemetry } from '../utils/errorUtils';
import { GIT_FANOUT_CONCURRENCY, mapLimit } from '../utils/concurrency';
import { ConfigService } from '../utils/configService';
import { resolveMaxDiffLength } from '../utils/diffTruncation';
import { GIT_OUTPUT_BUFFER_CAP, GitProcessRunner } from './gitProcessRunner';

// Minimum length for a commit message to be useful as a style example; shorter
// ones (e.g. "fix", "wip") teach the model bad habits.
const MIN_EXAMPLE_COMMIT_LENGTH = 10;

// Mechanical / low-signal commits whose style would mislead the example set.
const RECENT_COMMIT_NOISE = /^(?:merge\b|bump version|revert\b|wip\b|chore\(release\))/i;

export class GitService {
  /**
   * `stageAll` is set by the workflow when the commit message was generated
   * from the *unstaged* worktree diff (nothing was staged at generation time).
   * Without it the commit would miss the unstaged edits the message describes.
   */
  static async commitChanges(
    message: string,
    repoPath: string,
    stageAll: boolean,
  ): Promise<void> {
    try {
      if (stageAll) {
        // `-A` = modified + deleted + untracked, i.e. exactly the set the
        // unstaged diff was built from (the index equals HEAD in this branch).
        await this.executeGitCommand(['add', '-A'], repoPath);
      }
      // Not listFiles: after `add -A` a listing over the output cap must not
      // fail the commit; the count only feeds telemetry.
      const { stdout } = await this.execGit(['diff', '--cached', '--name-only', '-z'], repoPath);
      const fileCount = stdout.split('\0').filter(Boolean).length;
      if (fileCount === 0) {
        throw new NoChangesDetectedError();
      }

      await this.executeGitCommand(['commit', '-m', message], repoPath);
      Logger.log('Changes committed successfully');

      TelemetryService.sendEvent({
        name: 'commit_completed',
        fileCount,
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

  static async pushChanges(repoPath: string): Promise<void> {
    try {
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
   * Run a git listing with `-z` and return its paths. NUL-separated output
   * keeps paths with spaces/Unicode as-is (no C-quoting to undo). A listing
   * cut at the output cap would end in a half path, so it fails instead.
   */
  private static async listFiles(
    listArgs: string[],
    repoPath: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const { stdout, exitCode } = await this.execGit([...listArgs, '-z'], repoPath, { signal });
    if (exitCode === -1) {
      throw new Error(`git ${listArgs[0]} output is too large`);
    }
    return stdout.split('\0').filter(Boolean);
  }

  /**
   * The diff the message is generated from: the index when `staged`,
   * otherwise the whole worktree (tracked edits plus untracked files), which
   * the commit then stages with `add -A`. Submodule pointer moves are included,
   * dirty submodule content is not.
   */
  static async getDiff(
    repoPath: string,
    staged: boolean,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      // Never cut one file's diff below what `general.maxDiffSize` would send;
      // `-1` (Infinity) still caps one file at 1M chars to bound memory.
      const maxBuffer = Math.max(
        GIT_OUTPUT_BUFFER_CAP,
        Math.min(resolveMaxDiffLength(ConfigService.get('general.maxDiffSize')), 1_000_000),
      );
      let diff: string;
      if (staged) {
        const files = await this.listFiles(['diff', '--cached', '--name-only'], repoPath, signal);
        if (files.length === 0) {
          throw new NoChangesDetectedError(
            'No staged changes. Stage files or turn off commitSage.commit.onlyStagedChanges.',
          );
        }
        const renames = await this.getStagedRenameMap(repoPath, signal);
        diff = (await this.diffFiles(files, repoPath, ['diff', '--cached'], maxBuffer, signal, renames)).join('\n');
      } else {
        const tracked = await this.listFiles(['diff', '--name-only'], repoPath, signal);
        const untracked = await this.listFiles(['ls-files', '--others', '--exclude-standard'], repoPath, signal);
        diff = [
          section('# Unstaged changes:\n', await this.diffFiles(tracked, repoPath, ['diff'], maxBuffer, signal)),
          section('# New files:\n', await this.getUntrackedDiffs(untracked, repoPath, maxBuffer, signal)),
        ].filter(Boolean).join('\n');
      }

      diff = diff.trim();
      if (!diff) {
        throw new NoChangesDetectedError();
      }
      return diff;
    } catch (error) {
      if (error instanceof NoChangesDetectedError) {
        throw error;
      }
      const original = toError(error);
      Logger.error('Error getting diff:', original);
      // Re-throw with the prefix prepended but keep the original error (its
      // `name` and stack) so telemetry buckets stay meaningful.
      original.message = `Failed to get diff: ${original.message}`;
      throw original;
    }
  }

  /**
   * `newPath -> oldPath` for staged renames. The per-file diff below passes a
   * single pathspec, which git cannot pair with the deletion side, so a rename
   * reaches the model as a whole "new file" blob — misleading context, and for
   * a large file enough to eat the entire diff size budget. `-z` keeps paths
   * with spaces/Unicode intact (no C-quoting to undo).
   */
  private static async getStagedRenameMap(
    repoPath: string,
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const renames = new Map<string, string>();
    try {
      const output = await this.executeGitCommand(
        ['diff', '--cached', '--name-status', '-M', '-z'],
        repoPath,
        signal,
      );
      const fields = output.split('\0');
      for (let i = 0; i < fields.length; i++) {
        const status = fields[i];
        if (!status) { continue; }
        // R/C records carry two paths (old, new); every other status carries one.
        if (status.startsWith('R') || status.startsWith('C')) {
          const from = fields[i + 1];
          const to = fields[i + 2];
          if (from && to) { renames.set(to, from); }
          i += 2;
        } else {
          i += 1;
        }
      }
    } catch (error) {
      if (signal?.aborted) { throw error; }
      // Rename pairing is an optimization; fall back to plain per-file diffs.
      Logger.warn(`Failed to read staged renames: ${toError(error).message}`);
    }
    return renames;
  }

  /** Per-file diffs (bounded concurrency), blank ones dropped. */
  private static async diffFiles(
    files: string[],
    repoPath: string,
    diffArgs: string[],
    maxBuffer: number,
    signal?: AbortSignal,
    renames?: Map<string, string>,
  ): Promise<string[]> {
    const diffs = await mapLimit(files, GIT_FANOUT_CONCURRENCY, async (file) => {
      const renamedFrom = renames?.get(file);
      // Literal pathspecs: `[id].tsx` must not also match `i.tsx`. No color or
      // external diff tool, whatever the user's git config says.
      const args = ['--literal-pathspecs', ...diffArgs, '--no-color', '--no-ext-diff', '--ignore-submodules=dirty'];
      const { stdout } = await this.execGit(
        renamedFrom ? [...args, '-M', '--', renamedFrom, file] : [...args, '--', file],
        repoPath,
        { signal, maxBuffer },
      );
      return stdout;
    }, signal);
    return diffs.filter((diff) => diff.trim());
  }

  private static async getUntrackedDiffs(
    files: string[],
    repoPath: string,
    maxBuffer: number,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const diffs = await mapLimit(files, GIT_FANOUT_CONCURRENCY, async (file) => {
      try {
        // `git diff --no-index` always exits with 1 when the two inputs
        // differ (and 0 when they are identical), so we pass
        // allowNonZeroExit and use exitCode === 128 (or process error)
        // as the "real" failure signal.
        const { stdout, exitCode } = await this.execGit(
          ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', file],
          repoPath,
          { allowNonZeroExit: true, signal, maxBuffer },
        );
        return exitCode === 128 ? '' : stdout;
      } catch (error) {
        Logger.error(`Error diffing untracked file ${file}:`, toError(error));
        return '';
      }
    }, signal);
    return diffs.filter((diff) => diff.trim());
  }

  static async getBranchName(repoPath: string, signal?: AbortSignal): Promise<string> {
    try {
      return (await this.executeGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath, signal)).trim();
    } catch {
      return '';
    }
  }

  public static async hasHead(repoPath: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.execGit(['rev-parse', 'HEAD'], repoPath, { signal });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * `git status --porcelain` entries. Errors propagate: an empty list would
   * silently switch the workflow from staged to worktree mode.
   */
  static async getChangedFiles(
    repoPath: string,
    signal?: AbortSignal,
  ): Promise<ChangedFile[]> {
    const fields = await this.listFiles(['status', '--porcelain'], repoPath, signal);
    const files: ChangedFile[] = [];
    for (let i = 0; i < fields.length; i++) {
      const status = fields[i].substring(0, 2);
      files.push({ path: fields[i].substring(3), status });
      // With -z a rename/copy record is "XY new\0old\0"; skip the old path.
      if (/[RC]/.test(status)) {
        i++;
      }
    }
    return files;
  }

  /**
   * Recent commit messages for use as style examples in the prompt. Skips merge
   * commits (`--no-merges`), and filters out version-bump / revert / wip / very
   * short messages whose style would mislead. `scope: 'mine'` restricts to the
   * configured `user.email`. Over-fetches (count×3) before filtering so the
   * requested `count` survives the noise filter. Returns [] on any git error —
   * examples are best-effort context, never block generation.
   */
  static async getRecentCommitMessages(
    repoPath: string,
    count: number,
    scope: 'all' | 'mine' = 'all',
    signal?: AbortSignal,
  ): Promise<string[]> {
    if (count <= 0) {
      return [];
    }
    try {
      const args = ['log', '-n', String(count * 3), '--no-merges', '--format=%B%x00'];
      if (scope === 'mine') {
        const email = (await this.executeGitCommand(['config', 'user.email'], repoPath, signal)).trim();
        if (email) {
          args.push(`--author=${email}`);
        }
      }
      const output = await this.executeGitCommand(args, repoPath, signal);
      return output
        .split('\0')
        .map(m => m.trim())
        .filter(m => m.length >= MIN_EXAMPLE_COMMIT_LENGTH && !RECENT_COMMIT_NOISE.test(m))
        .slice(0, count);
    } catch (error) {
      Logger.error('Error reading recent commit messages:', toError(error));
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

  /**
   * Runs a `git` subcommand and returns its raw stdout/stderr/exit code.
   * Thin delegate to {@link GitProcessRunner.execGit} — kept on `GitService`
   * because callers (and the blame analyzer) reach git through this facade.
   */
  public static async execGit(
    args: string[],
    cwd: string,
    options: { signal?: AbortSignal; allowNonZeroExit?: boolean; maxBuffer?: number } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return GitProcessRunner.execGit(args, cwd, options);
  }
}

function section(header: string, diffs: string[]): string {
  return diffs.length > 0 ? header + diffs.join('\n') : '';
}

/** Result of `getChangedFiles`. `status` is the raw 2-char `git status --porcelain` code. */
interface ChangedFile {
  path: string;
  status: string;
}

/**
 * Decode whether the porcelain status code corresponds to a deleted file.
 * The file is gone from the worktree when the worktree column (Y) is 'D' —
 * that covers ' D' (unstaged delete) and the combined codes 'AD' / 'MD' / 'RD'
 * (staged, then deleted on disk) — or when the code is exactly 'D ' (staged
 * delete). 'DM' stays false: the index deletion is staged but the path is
 * back on disk.
 */
export function isDeletedStatus(status: string): boolean {
  return status === 'D ' || status[1] === 'D';
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
 * "unmodified" ' ' or "untracked" '?'), so the staged flag and the staged file
 * subset both come from the one `git status --porcelain` parse.
 */
export function isIndexStaged(status: string): boolean {
  const x = status[0];
  return x !== ' ' && x !== '?';
}
