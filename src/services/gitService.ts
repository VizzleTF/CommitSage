import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../utils/logger';
import {
  GitExtensionNotFoundError,
  NoRepositoriesFoundError,
  NoChangesDetectedError,
  NoRepositorySelectedError,
} from '../models/errors';
import { TelemetryService } from './telemetryService';
import { toError, sanitizeErrorForTelemetry } from '../utils/errorUtils';
import { unquoteGitPath } from '../utils/gitPath';
import { ConfigService } from '../utils/configService';
import { mapLimit } from '../utils/concurrency';

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

const STAGED_STATUS_CODES: GitStatusCode[] = [
  GIT_STATUS_CODES.modified,
  GIT_STATUS_CODES.added,
  GIT_STATUS_CODES.deleted,
  GIT_STATUS_CODES.renamed,
];

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
        const filesToStage: string[] = [];
        if (hasUntrackedFiles) {
          const untracked = await this.executeGitCommand(
            ['ls-files', '--others', '--exclude-standard'],
            repoPath,
          );
          filesToStage.push(
            ...untracked
              .split('\n')
              .filter((f) => f.trim())
              .map(unquoteGitPath),
          );
        }
        if (hasDeletedFiles) {
          const deleted = await this.executeGitCommand(
            ['ls-files', '--deleted'],
            repoPath,
          );
          filesToStage.push(
            ...deleted
              .split('\n')
              .filter((f) => f.trim())
              .map(unquoteGitPath),
          );
        }
        if (filesToStage.length > 0) {
          await this.executeGitCommand(
            ['add', '--', ...filesToStage],
            repoPath,
          );
        }
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

  static async getDiff(
    repoPath: string,
    onlyStagedChanges: boolean,
    knownHasStagedChanges?: boolean,
  ): Promise<string> {
    try {
      const hasHead = await this.hasHead(repoPath);
      const hasStagedChanges = knownHasStagedChanges ?? await this.hasChanges(repoPath, 'staged');
      const hasUnstagedChanges =
        !onlyStagedChanges && (await this.hasChanges(repoPath, 'unstaged'));
      const hasUntrackedFiles =
        !onlyStagedChanges &&
        !hasStagedChanges &&
        (await this.hasChanges(repoPath, 'untracked'));
      const hasDeletedFiles =
        hasHead &&
        !onlyStagedChanges &&
        !hasStagedChanges &&
        (await this.hasChanges(repoPath, 'deleted'));

      if (
        !hasStagedChanges &&
        !hasUnstagedChanges &&
        !hasUntrackedFiles &&
        !hasDeletedFiles
      ) {
        throw new NoChangesDetectedError();
      }

      const diffs: string[] = [];

      if (onlyStagedChanges && hasStagedChanges) {
        const staged = await this.getStagedDiff(repoPath);
        diffs.push(...staged);
        return diffs.join('\n\n').trim();
      }

      if (hasStagedChanges) {
        const staged = await this.getStagedDiff(repoPath, '# Staged changes:\n');
        diffs.push(...staged);
      }

      if (hasUnstagedChanges) {
        const unstaged = await this.getUnstagedDiff(repoPath);
        diffs.push(...unstaged);
      }

      if (hasUntrackedFiles) {
        const untracked = await this.getUntrackedDiff(repoPath);
        if (untracked) {
          diffs.push(untracked);
        }
      }

      if (hasDeletedFiles) {
        const deleted = await this.getDeletedDiff(repoPath);
        if (deleted) {
          diffs.push(deleted);
        }
      }

      const combinedDiff = diffs.join('\n\n').trim();
      if (!combinedDiff) {
        throw new NoChangesDetectedError();
      }

      return combinedDiff;
    } catch (error) {
      if (error instanceof NoChangesDetectedError) {
        throw error;
      }
      Logger.error('Error getting diff:', toError(error));
      throw new Error(`Failed to get diff: ${(toError(error)).message}`, { cause: error });
    }
  }

  private static async isSubmodule(file: string, repoPath: string): Promise<boolean> {
    try {
      const { stdout } = await this.execGit(
        ['ls-files', '--stage', '--', file],
        repoPath,
      );
      return stdout.includes('160000');
    } catch {
      return false;
    }
  }

  private static async getDiffForFiles(
    repoPath: string,
    listArgs: string[],
    diffArgs: string[],
    prefix?: string
  ): Promise<string[]> {
    const files = (await this.executeGitCommand(listArgs, repoPath))
      .split('\n')
      .filter((file) => file.trim())
      .map(unquoteGitPath);

    const results = await mapLimit(files, GIT_FANOUT_CONCURRENCY, async (file) => {
      if (await this.isSubmodule(file, repoPath)) {
        return null;
      }
      const fileDiff = await this.executeGitCommand(
        [...diffArgs, '--', file],
        repoPath,
      );
      if (!fileDiff.trim()) {
        return null;
      }
      return prefix ? prefix + fileDiff : fileDiff;
    });

    return results.filter((d): d is string => d !== null);
  }

  private static async getStagedDiff(repoPath: string, prefix?: string): Promise<string[]> {
    return this.getDiffForFiles(
      repoPath,
      ['diff', '--cached', '--name-only'],
      ['diff', '--cached'],
      prefix,
    );
  }

  private static async getUnstagedDiff(repoPath: string): Promise<string[]> {
    return this.getDiffForFiles(
      repoPath,
      ['diff', '--name-only'],
      ['diff'],
      '# Unstaged changes:\n',
    );
  }

  private static async getUntrackedDiff(repoPath: string): Promise<string> {
    const untrackedFiles = await this.executeGitCommand(
      ['ls-files', '--others', '--exclude-standard'],
      repoPath,
    );
    const untrackedFileList = untrackedFiles
      .split('\n')
      .filter((file) => file.trim())
      .map(unquoteGitPath);

    const untrackedDiff = await mapLimit(
      untrackedFileList,
      GIT_FANOUT_CONCURRENCY,
      async (file) => {
        try {
          // `git diff --no-index` always exits with 1 when the two inputs
          // differ (and 0 when they are identical), so we pass
          // allowNonZeroExit and use exitCode === 128 (or process error)
          // as the "real" failure signal.
          const { stdout, exitCode } = await this.execGit(
            ['diff', '--no-index', '--', '/dev/null', file],
            repoPath,
            { allowNonZeroExit: true },
          );
          if (exitCode === 128) {
            return '';
          }
          return stdout;
        } catch (error) {
          Logger.error(`Error diffing untracked file ${file}:`, toError(error));
          return '';
        }
      },
    );
    const validDiffs = untrackedDiff.filter((diff) => diff.trim());
    return validDiffs.length > 0 ? '# New files:\n' + validDiffs.join('\n') : '';
  }

  private static async getDeletedDiff(repoPath: string): Promise<string> {
    const deletedFiles = await this.executeGitCommand(
      ['ls-files', '--deleted'],
      repoPath,
    );
    const deletedFileList = deletedFiles
      .split('\n')
      .filter((file) => file.trim())
      .map(unquoteGitPath);

    const deletedDiff = await mapLimit(
      deletedFileList,
      GIT_FANOUT_CONCURRENCY,
      async (file) => {
        try {
          // git diff -- <file> on a deleted file (in the working tree) emits
          // a proper unified diff against HEAD. No manual header construction.
          const fileDiff = await this.executeGitCommand(
            ['diff', '--', file],
            repoPath,
          );
          return fileDiff;
        } catch (error) {
          Logger.error(`Error diffing deleted file ${file}:`, toError(error));
          return '';
        }
      },
    );
    const validDiffs = deletedDiff.filter((diff) => diff.trim());
    return validDiffs.length > 0 ? '# Deleted files:\n' + validDiffs.join('\n') : '';
  }

  public static async hasHead(repoPath: string): Promise<boolean> {
    try {
      await this.execGit(['rev-parse', 'HEAD'], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  static async hasChanges(
    repoPath: string,
    type: 'staged' | 'unstaged' | 'untracked' | 'deleted',
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

      const output = await this.executeGitCommand(command, repoPath);
      return output.trim().length > 0;
    } catch (error) {
      Logger.error(`Error checking for ${type} changes:`, toError(error));
      return false;
    }
  }

  static async getChangedFiles(
    repoPath: string,
    onlyStaged: boolean = false,
  ): Promise<string[]> {
    try {
      const statusCommand = ['status', '--porcelain'];
      const output = await this.executeGitCommand(statusCommand, repoPath);

      return output
        .split('\n')
        .filter((line) => line.trim() !== '')
        .filter((line) => {
          if (onlyStaged) {
            // For staged changes, check first character
            return STAGED_STATUS_CODES.includes(line[0] as GitStatusCode);
          }
          // For all changes, check both staged and unstaged status
          const [staged, unstaged] = [line[0], line[1]];
          return staged !== ' ' || unstaged !== ' ';
        })
        .map((line) => {
          const status = line.substring(0, 2);
          let filePath = line.substring(3).trim();

          // Handle renamed files (they have format "R100 old-name -> new-name")
          if (status.startsWith('R')) {
            filePath = filePath.split(' -> ')[1];
          }

          // Unquote paths that git quoted due to spaces or special characters
          filePath = unquoteGitPath(filePath);

          return filePath;
        });
    } catch (error) {
      Logger.error('Error getting changed files:', toError(error));
      return [];
    }
  }

  private static async executeGitCommand(
    args: string[],
    cwd: string,
  ): Promise<string> {
    const { stdout } = await this.execGit(args, cwd);
    return stdout;
  }

  static async getRepositories(): Promise<vscode.SourceControl[]> {
    const extension =
      vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      throw new GitExtensionNotFoundError();
    }

    const gitExtension = await extension.activate();
    const git = gitExtension.getAPI(1);

    if (!git?.repositories?.length) {
      throw new NoRepositoriesFoundError();
    }

    return git.repositories;
  }

  static async selectRepository(
    repos: vscode.SourceControl[],
  ): Promise<vscode.SourceControl> {
    const repoOptions = repos.map((repo) => ({
      label: repo.rootUri
        ? path.basename(repo.rootUri.fsPath)
        : 'Unknown repository',
      description: repo.rootUri ? repo.rootUri.fsPath : undefined,
      repository: repo,
    }));

    const selected = await vscode.window.showQuickPick(repoOptions, {
      placeHolder: 'Select the repository to generate commit message',
    });

    if (!selected) {
      throw new NoRepositorySelectedError();
    }
    return selected.repository;
  }

  static async getActiveRepository(
    sourceControlRepository?: vscode.SourceControl,
  ): Promise<vscode.SourceControl> {
    if (sourceControlRepository?.rootUri) {
      return sourceControlRepository;
    }

    const repos = await this.getRepositories();
    if (repos.length === 1) {
      return repos[0];
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const activeFile = activeEditor.document.uri;
      const activeRepo = repos.find((repo) => {
        if (!repo.rootUri) {
          return false;
        }
        return activeFile.fsPath.startsWith(repo.rootUri.fsPath);
      });
      if (activeRepo) {
        return activeRepo;
      }
    }

    return this.selectRepository(repos);
  }

  static async validateGitExtension(): Promise<void> {
    const extension =
      vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      throw new GitExtensionNotFoundError();
    }
    await extension.activate();
  }

  public static async execGit(
    args: string[],
    cwd: string,
    options: { signal?: AbortSignal; allowNonZeroExit?: boolean } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timeoutSeconds = ConfigService.getApiRequestTimeout();
      const timeoutMs =
        timeoutSeconds === -1 ? undefined : timeoutSeconds * 1000;

      const child = spawn('git', args, {
        cwd,
        env: {
          ...process.env,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          GIT_TERMINAL_PROMPT: '0',
        },
        timeout: timeoutMs,
      });
      let stdout = '';
      let stderr = '';
      let aborted = false;

      const onAbort = (): void => {
        aborted = true;
        child.kill('SIGTERM');
        // Hard-kill if still alive after grace period
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 1500).unref?.();
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err: Error) => {
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        reject(err);
      });

      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        if (aborted) {
          reject(new Error('Git command cancelled'));
          return;
        }
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          // Likely killed by the spawn `timeout` option
          reject(
            new Error(
              `Git command timed out after ${timeoutSeconds}s: git ${args[0] ?? ''}`,
            ),
          );
          return;
        }
        const exitCode = code ?? -1;
        if (code === 0 || options.allowNonZeroExit) {
          resolve({ stdout, stderr, exitCode });
        } else {
          reject(
            new Error(`Git command failed with code ${code}: ${stderr}`),
          );
        }
      });
    });
  }

  public static async isNewFile(
    filePath: string,
    repoPath: string,
  ): Promise<boolean> {
    const normalizedPath = path.normalize(filePath.replace(/^\/+/, ''));
    const { stdout } = await this.execGit(
      ['status', '--porcelain', '--', normalizedPath],
      repoPath,
    );
    const status = stdout.slice(0, 2);
    return status === '??' || status === 'A ';
  }

  public static async isFileDeleted(
    filePath: string,
    repoPath: string,
  ): Promise<boolean> {
    const normalizedPath = path.normalize(filePath.replace(/^\/+/, ''));
    const { stdout } = await this.execGit(
      ['status', '--porcelain', '--', normalizedPath],
      repoPath,
    );
    const status = stdout.slice(0, 2);
    return status === ' D' || status === 'D ';
  }
}

interface GitExtension {
  getAPI(version: 1): {
    repositories: vscode.SourceControl[];
  };
}
