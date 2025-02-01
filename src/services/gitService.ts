import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { Logger } from '../utils/logger';
import {
    GitExtensionNotFoundError,
    NoRepositoriesFoundError,
    NoChangesDetectedError,
    NoRepositorySelectedError
} from '../models/errors';
import { TelemetryService } from './telemetryService';

const GIT_STATUS_CODES = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    untracked: '??'
} as const;

type GitStatusCode = typeof GIT_STATUS_CODES[keyof typeof GIT_STATUS_CODES];

const STAGED_STATUS_CODES: GitStatusCode[] = [
    GIT_STATUS_CODES.modified,
    GIT_STATUS_CODES.added,
    GIT_STATUS_CODES.deleted,
    GIT_STATUS_CODES.renamed
];

export class GitService {
    static async initialize(): Promise<void> {
        try {
            void Logger.log('Initializing Git service');
            await this.validateGitExtension();
            void Logger.log('Git service initialized successfully');
        } catch (error) {
            void Logger.error('Failed to initialize Git service:', error as Error);
            throw error;
        }
    }

    static async commitChanges(message: string, repository?: vscode.SourceControl): Promise<void> {
        try {
            const repo = repository || await this.getActiveRepository();
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
                await this.executeGitCommand(['add', '-A'], repoPath);
            }

            await this.executeGitCommand(['commit', '-m', message], repoPath);
            void vscode.window.showInformationMessage('Changes committed successfully');

            void TelemetryService.sendEvent('commit_completed', {
                hasStaged: hasStagedChanges,
                hasUntracked: hasUntrackedFiles,
                hasDeleted: hasDeletedFiles,
                messageLength: message.length
            });
        } catch (error) {
            void TelemetryService.sendEvent('commit_failed', {
                error: (error as Error).message
            });
            void Logger.error('Failed to commit changes:', error as Error);
            throw error;
        }
    }

    private static async hasRemotes(repoPath: string): Promise<boolean> {
        try {
            const result = await this.executeGitCommand(['remote'], repoPath);
            return result.trim().length > 0;
            // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
        } catch (error) {
            return false;
        }
    }

    static async pushChanges(repository?: vscode.SourceControl): Promise<void> {
        try {
            const repo = repository || await this.getActiveRepository();
            if (!repo?.rootUri) {
                throw new Error('No active repository found');
            }

            const repoPath = repo.rootUri.fsPath;
            if (!await this.hasRemotes(repoPath)) {
                throw new Error('Repository has no configured remotes. Please add a remote repository using git remote add <name> <url>');
            }

            await this.executeGitCommand(['push'], repoPath);
        } catch (error) {
            void Logger.error('Failed to push changes:', error as Error);
            throw error;
        }
    }

    static async getDiff(repoPath: string, onlyStagedChanges: boolean): Promise<string> {
        try {
            const hasHead = await this.hasHead(repoPath);
            const hasStagedChanges = await this.hasChanges(repoPath, 'staged');
            const hasUnstagedChanges = !onlyStagedChanges && await this.hasChanges(repoPath, 'unstaged');
            const hasUntrackedFiles = !onlyStagedChanges && !hasStagedChanges && await this.hasChanges(repoPath, 'untracked');
            const hasDeletedFiles = hasHead && !onlyStagedChanges && !hasStagedChanges && await this.hasChanges(repoPath, 'deleted');

            if (!hasStagedChanges && !hasUnstagedChanges && !hasUntrackedFiles && !hasDeletedFiles) {
                throw new NoChangesDetectedError();
            }

            const diffs: string[] = [];

            if (hasStagedChanges) {
                const stagedDiff = await this.executeGitCommand(['diff', '--cached'], repoPath);
                if (stagedDiff.trim()) {
                    diffs.push(stagedDiff);
                }
                return diffs.join('\n\n').trim();
            }

            if (hasUntrackedFiles) {
                const untrackedFiles = await this.executeGitCommand(['ls-files', '--others', '--exclude-standard'], repoPath);
                const untrackedDiff = untrackedFiles.split('\n')
                    .filter(file => file.trim())
                    .map(file => `diff --git a/${file} b/${file}\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n\\ No newline at end of file\n`)
                    .join('\n');
                if (untrackedDiff) {
                    diffs.push(untrackedDiff);
                }
            }

            if (hasDeletedFiles) {
                const deletedFiles = await this.executeGitCommand(['ls-files', '--deleted'], repoPath);
                const deletedDiff = await Promise.all(
                    deletedFiles.split('\n')
                        .filter(file => file.trim())
                        .map(async file => {
                            try {
                                const oldContent = await this.executeGitCommand(['show', `HEAD:${file}`], repoPath);
                                return `diff --git a/${file} b/${file}\ndeleted file mode 100644\n--- a/${file}\n+++ /dev/null\n@@ -1 +0,0 @@\n-${oldContent.trim()}\n`;
                                // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
                            } catch (error) {
                                return '';
                            }
                        })
                );
                const validDeletedDiffs = deletedDiff.filter(diff => diff.trim());
                if (validDeletedDiffs.length > 0) {
                    diffs.push(validDeletedDiffs.join('\n'));
                }
            }

            if (hasUnstagedChanges) {
                const unstagedDiff = await this.executeGitCommand(['diff'], repoPath);
                if (unstagedDiff.trim()) {
                    diffs.push(unstagedDiff);
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
            void Logger.error('Error getting diff:', error as Error);
            throw new Error(`Failed to get diff: ${(error as Error).message}`);
        }
    }

    public static async hasHead(repoPath: string): Promise<boolean> {
        try {
            await this.execGit(['rev-parse', 'HEAD'], repoPath);
            return true;
            // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
        } catch (error) {
            return false;
        }
    }

    static async hasChanges(repoPath: string, type: 'staged' | 'unstaged' | 'untracked' | 'deleted'): Promise<boolean> {
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
            void Logger.error(`Error checking for ${type} changes:`, error as Error);
            return false;
        }
    }

    static async getChangedFiles(repoPath: string, onlyStaged: boolean = false): Promise<string[]> {
        try {
            const hasHead = await this.hasHead(repoPath);
            const statusCommand = ['status', '--porcelain'];
            const output = await this.executeGitCommand(statusCommand, repoPath);

            return output.split('\n')
                .filter(line => line.trim() !== '')
                .filter(line => onlyStaged ? STAGED_STATUS_CODES.includes(line[0] as GitStatusCode) : true)
                .map(line => {
                    const status = line.substring(0, 2);
                    const filePath = line.substring(3).trim();
                    if (!hasHead || status === '??' || status === 'A ') {
                        void Logger.log(`Skipping blame analysis for new file: ${filePath}`);
                    }
                    return filePath;
                });
        } catch (error) {
            void Logger.error('Error getting changed files:', error as Error);
            return [];
        }
    }

    private static async readFileContent(repoPath: string, filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const fullPath = vscode.Uri.file(path.join(repoPath, filePath));
            vscode.workspace.fs.readFile(fullPath).then(
                content => resolve(new TextDecoder().decode(content)),
                error => reject(error)
            );
        });
    }

    static async checkGitConfig(repoPath: string): Promise<void> {
        const userName = await this.executeGitCommand(['config', 'user.name'], repoPath);
        const userEmail = await this.executeGitCommand(['config', 'user.email'], repoPath);

        if (!userName.trim() || !userEmail.trim()) {
            throw new Error('Git user.name or user.email is not configured.');
        }
    }

    private static executeGitCommand(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const childProcess = spawn('git', args, { cwd });
            let stdout = '';
            let stderr = '';

            childProcess.stdout.on('data', (data) => { stdout += data; });
            childProcess.stderr.on('data', (data) => {
                stderr += data;
                void Logger.error(`Git command stderr: ${data}`);
            });

            childProcess.on('error', (error) => {
                void Logger.error(`Git command error: ${error.message}`);
                reject(new Error(`Git command failed: ${error.message}`));
            });

            childProcess.on('close', (code) => {
                if (code !== 0) {
                    const errorMessage = `Git ${args.join(' ')} failed with code ${code}${stderr ? ': ' + stderr : ''}`;
                    void Logger.error(errorMessage);
                    reject(new Error(errorMessage));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    static async getRepositories(): Promise<vscode.SourceControl[]> {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
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

    static async selectRepository(repos: vscode.SourceControl[]): Promise<vscode.SourceControl> {
        const repoOptions = repos.map(repo => ({
            label: repo.rootUri ? path.basename(repo.rootUri.fsPath) : 'Unknown repository',
            description: repo.rootUri ? repo.rootUri.fsPath : undefined,
            repository: repo
        }));

        const selected = await vscode.window.showQuickPick(repoOptions, {
            placeHolder: 'Select the repository to generate commit message'
        });

        if (!selected) {
            throw new NoRepositorySelectedError();
        }
        return selected.repository;
    }

    static async getActiveRepository(sourceControlRepository?: vscode.SourceControl): Promise<vscode.SourceControl> {
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
            const activeRepo = repos.find(repo => {
                if (!repo.rootUri) { return false; }
                return activeFile.fsPath.startsWith(repo.rootUri.fsPath);
            });
            if (activeRepo) {
                return activeRepo;
            }
        }

        return this.selectRepository(repos);
    }

    static async validateGitExtension(): Promise<void> {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!extension) {
            throw new GitExtensionNotFoundError();
        }
        await extension.activate();
    }

    public static async execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const process = spawn('git', args, { cwd });
            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Git command failed with code ${code}: ${stderr}`));
                }
            });
        });
    }

    private static async getStatus(filePath: string): Promise<string> {
        const repoPath = path.dirname(filePath);
        const { stdout } = await this.execGit(['status', '--porcelain', filePath], repoPath);
        return stdout.trim().slice(0, 2);
    }

    public static async isNewFile(filePath: string): Promise<boolean> {
        try {
            const status = await this.getStatus(filePath);
            return status === '??' || status === 'A';
        } catch (error) {
            // Only log critical errors
            if (error instanceof Error && !error.message.includes('not found')) {
                void Logger.error('Error checking if file is new:', error);
            }
            return false;
        }
    }

    public static async isFileDeleted(filePath: string): Promise<boolean> {
        try {
            const status = await this.getStatus(filePath);
            return status.startsWith('D');
        } catch (error) {
            // Only log critical errors
            if (error instanceof Error && !error.message.includes('not found')) {
                void Logger.error('Error checking if file is deleted:', error);
            }
            return false;
        }
    }
}

interface GitExtension {
    getAPI(version: 1): {
        repositories: vscode.SourceControl[];
    };
}
