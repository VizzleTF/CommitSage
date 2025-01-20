import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Logger } from '../utils/logger';
import {
    GitExtensionNotFoundError,
    NoRepositoriesFoundError,
    NoChangesDetectedError,
    NoRepositorySelectedError
} from '../models/errors';
import { TelemetryService } from './telemetryService';

const GIT_STATUS_CODES = {
    MODIFIED: 'M',
    ADDED: 'A',
    DELETED: 'D',
    RENAMED: 'R',
    UNTRACKED: '??'
} as const;

type GitStatusCode = typeof GIT_STATUS_CODES[keyof typeof GIT_STATUS_CODES];
type GitChangeType = 'staged' | 'untracked';

const STAGED_STATUS_CODES: GitStatusCode[] = [
    GIT_STATUS_CODES.MODIFIED,
    GIT_STATUS_CODES.ADDED,
    GIT_STATUS_CODES.DELETED,
    GIT_STATUS_CODES.RENAMED
];

export class GitService {
    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        try {
            void Logger.log('Initializing Git service');
            await this.validateGitExtension();
            void Logger.log('Git service initialized successfully');
        } catch (error) {
            void Logger.error('Failed to initialize Git service:', error as Error);
            throw error;
        }
    }

    static async commitChanges(message: string): Promise<void> {
        try {
            const repo = await this.getActiveRepository();
            if (!repo?.rootUri) {
                throw new Error('No active repository found');
            }

            const repoPath = repo.rootUri.fsPath;
            const hasStagedChanges = await this.hasChanges(repoPath, 'staged');
            const hasUntrackedFiles = await this.hasChanges(repoPath, 'untracked');

            if (!hasStagedChanges && !hasUntrackedFiles) {
                throw new NoChangesDetectedError();
            }

            if (hasUntrackedFiles && !hasStagedChanges) {
                await this.executeGitCommand(['add', '.'], repoPath);
            }

            const commitArgs = hasStagedChanges ?
                ['commit', '-m', message] :
                ['commit', '-a', '-m', message];

            await this.executeGitCommand(commitArgs, repoPath);
            void vscode.window.showInformationMessage('Changes committed successfully');

            void TelemetryService.sendEvent('commit_completed', {
                hasStaged: hasStagedChanges,
                hasUntracked: hasUntrackedFiles,
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

    static async pushChanges(): Promise<void> {
        try {
            const repo = await this.getActiveRepository();
            if (!repo?.rootUri) {
                throw new Error('No active repository found');
            }

            await this.executeGitCommand(['push'], repo.rootUri.fsPath);
        } catch (error) {
            void Logger.error('Failed to push changes:', error as Error);
            throw error;
        }
    }

    static async getDiff(repoPath: string, onlyStaged: boolean = false): Promise<string> {
        void Logger.log(`Getting diff for ${repoPath} (onlyStaged: ${onlyStaged})`);

        try {
            // Get staged changes first
            const stagedDiff = await this.executeGitCommand(['diff', '--staged'], repoPath);
            if (stagedDiff.trim()) {
                return stagedDiff;
            }

            if (onlyStaged) {
                throw new NoChangesDetectedError('No staged changes detected.');
            }

            // Get unstaged changes
            const [unstaged, untrackedFiles] = await Promise.all([
                this.executeGitCommand(['diff'], repoPath),
                this.getUntrackedFiles(repoPath)
            ]);

            // Process untracked files in parallel
            const untrackedContents = await Promise.all(
                untrackedFiles.map(async file => {
                    try {
                        const fileContent = await this.executeGitCommand(['show', `:${file}`], repoPath)
                            .catch(() => '');

                        if (!fileContent) return '';

                        return [
                            `diff --git a/${file} b/${file}`,
                            'new file mode 100644',
                            '--- /dev/null',
                            `+++ b/${file}`,
                            ...fileContent.split('\n').map(line => `+${line}`)
                        ].join('\n') + '\n';
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        void Logger.log(`Error reading content of ${file}: ${errorMessage}`);
                        return '';
                    }
                })
            );

            const combinedDiff = [
                unstaged,
                ...untrackedContents.filter(content => content.length > 0)
            ].join('\n').trim();

            if (!combinedDiff) {
                throw new NoChangesDetectedError('No changes detected.');
            }

            return combinedDiff;
        } catch (error) {
            void Logger.error('Error getting diff:', error as Error);
            throw error;
        }
    }

    private static async getUntrackedFiles(repoPath: string): Promise<string[]> {
        const command = ['ls-files', '--others', '--exclude-standard'];
        const output = await this.executeGitCommand(command, repoPath);
        return output.split('\n').filter(line => line.trim() !== '');
    }

    static async hasChanges(repoPath: string, type: GitChangeType): Promise<boolean> {
        try {
            const statusOutput = await this.executeGitCommand(['status', '--porcelain'], repoPath);
            return statusOutput.split('\n').some(line => {
                const trimmedLine = line.trim();
                if (!trimmedLine) return false;

                if (type === 'staged') {
                    return STAGED_STATUS_CODES.includes(line[0] as GitStatusCode);
                }
                return line.startsWith(GIT_STATUS_CODES.UNTRACKED);
            });
        } catch (error) {
            void Logger.error(`Error checking ${type} changes:`, error as Error);
            return false;
        }
    }

    static async getChangedFiles(repoPath: string, onlyStaged: boolean = false): Promise<string[]> {
        const statusCommand = ['status', '--porcelain'];
        const output = await this.executeGitCommand(statusCommand, repoPath);
        return output.split('\n')
            .filter(line => line.trim() !== '')
            .filter(line => !onlyStaged || STAGED_STATUS_CODES.includes(line[0] as GitStatusCode))
            .map(line => line.substring(3).trim());
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
        if (repos.length === 1) {
            return repos[0];
        }

        const repoOptions = repos.map(repo => ({
            label: repo.rootUri ? repo.rootUri.fsPath : 'Unknown repository path',
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

    static async getActiveRepository(): Promise<vscode.SourceControl | undefined> {
        const repos = await this.getRepositories();
        if (repos.length === 1) {
            return repos[0];
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
}

interface GitExtension {
    getAPI(version: 1): {
        repositories: vscode.SourceControl[];
    };
}