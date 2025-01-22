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

    static async getDiff(repoPath: string, onlyStagedChanges: boolean = false): Promise<string> {
        void Logger.log(`Getting diff for ${repoPath} (onlyStagedChanges: ${onlyStagedChanges})`);

        try {
            // Check for staged changes first
            const stagedDiff = await this.executeGitCommand(['diff', '--staged'], repoPath);

            // If onlyStagedChanges is true, return only staged changes
            if (onlyStagedChanges) {
                if (!stagedDiff.trim()) {
                    throw new NoChangesDetectedError('No staged changes detected.');
                }
                return stagedDiff;
            }

            // If there are staged changes, return them (even when onlyStagedChanges is false)
            if (stagedDiff.trim()) {
                return stagedDiff;
            }

            // Get status of all files
            const status = await this.executeGitCommand(['status', '--porcelain', '-u'], repoPath);
            if (!status.trim()) {
                throw new NoChangesDetectedError('No changes detected.');
            }

            const diffs: string[] = [];

            // Get unstaged modifications
            const unstagedDiff = await this.executeGitCommand(['diff'], repoPath);
            if (unstagedDiff.trim()) {
                diffs.push(unstagedDiff);
            }

            // Process each file from status
            const statusLines = status.split('\n').filter(line => line.trim());
            for (const line of statusLines) {
                const [status, ...pathParts] = line.trim().split(' ');
                const filePath = pathParts.join(' ');

                if (status === '??') {
                    // New untracked file
                    try {
                        const fileContent = await this.readFileContent(repoPath, filePath);
                        if (fileContent) {
                            diffs.push([
                                `diff --git a/${filePath} b/${filePath}`,
                                'new file mode 100644',
                                '--- /dev/null',
                                `+++ b/${filePath}`,
                                ...fileContent.split('\n').map(line => `+${line}`)
                            ].join('\n'));
                        }
                    } catch (error) {
                        void Logger.error(`Error reading new file ${filePath}:`, error as Error);
                    }
                } else if (status === 'D') {
                    // Deleted file
                    try {
                        const oldContent = await this.executeGitCommand(['show', `HEAD:${filePath}`], repoPath);
                        if (oldContent) {
                            diffs.push([
                                `diff --git a/${filePath} b/${filePath}`,
                                'deleted file mode 100644',
                                `--- a/${filePath}`,
                                '+++ /dev/null',
                                ...oldContent.split('\n').map(line => `-${line}`)
                            ].join('\n'));
                        }
                    } catch (error) {
                        void Logger.error(`Error reading deleted file ${filePath}:`, error as Error);
                    }
                }
            }

            const combinedDiff = diffs.join('\n\n').trim();
            if (!combinedDiff) {
                throw new NoChangesDetectedError('No changes detected.');
            }

            return combinedDiff;
        } catch (error) {
            void Logger.error('Error getting diff:', error as Error);
            throw error;
        }
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