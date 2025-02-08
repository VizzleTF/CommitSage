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
import * as fs from 'fs';

const GIT_STATUS_CODES = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    untracked: '??',
    submodule: 'S'
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
        } catch {
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

            // Skip submodule changes
            const isSubmodule = async (file: string): Promise<boolean> => {
                try {
                    const { stdout } = await this.execGit(['ls-files', '--stage', file], repoPath);
                    return stdout.includes('160000');
                } catch {
                    return false;
                }
            };

            // If we only want staged changes and there are some, return only those
            if (onlyStagedChanges && hasStagedChanges) {
                const stagedFiles = (await this.executeGitCommand(['diff', '--cached', '--name-only'], repoPath))
                    .split('\n')
                    .filter(file => file.trim());

                for (const file of stagedFiles) {
                    if (!(await isSubmodule(file))) {
                        const fileDiff = await this.executeGitCommand(['diff', '--cached', file], repoPath);
                        if (fileDiff.trim()) {
                            diffs.push(fileDiff);
                        }
                    }
                }
                return diffs.join('\n\n').trim();
            }

            // Otherwise, get all changes
            if (hasStagedChanges) {
                const stagedFiles = (await this.executeGitCommand(['diff', '--cached', '--name-only'], repoPath))
                    .split('\n')
                    .filter(file => file.trim());

                for (const file of stagedFiles) {
                    if (!(await isSubmodule(file))) {
                        const fileDiff = await this.executeGitCommand(['diff', '--cached', file], repoPath);
                        if (fileDiff.trim()) {
                            diffs.push('# Staged changes:\n' + fileDiff);
                        }
                    }
                }
            }

            if (hasUnstagedChanges) {
                const unstagedFiles = (await this.executeGitCommand(['diff', '--name-only'], repoPath))
                    .split('\n')
                    .filter(file => file.trim());

                for (const file of unstagedFiles) {
                    if (!(await isSubmodule(file))) {
                        const fileDiff = await this.executeGitCommand(['diff', file], repoPath);
                        if (fileDiff.trim()) {
                            diffs.push('# Unstaged changes:\n' + fileDiff);
                        }
                    }
                }
            }

            if (hasUntrackedFiles) {
                const untrackedFiles = await this.executeGitCommand(['ls-files', '--others', '--exclude-standard'], repoPath);
                const untrackedDiff = await Promise.all(
                    untrackedFiles.split('\n')
                        .filter(file => file.trim())
                        .map(async file => {
                            try {
                                // Read the content of the new file
                                const content = await fs.promises.readFile(path.join(repoPath, file), 'utf-8');
                                const lines = content.split('\n');
                                const contentDiff = lines.map(line => `+${line}`).join('\n');
                                return `diff --git a/${file} b/${file}\nnew file mode 100644\nindex 0000000..${this.calculateFileHash(content)}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${contentDiff}`;
                            } catch (error) {
                                void Logger.error(`Error reading new file ${file}:`, error as Error);
                                return '';
                            }
                        })
                );
                const validUntrackedDiffs = untrackedDiff.filter(diff => diff.trim());
                if (validUntrackedDiffs.length > 0) {
                    diffs.push('# New files:\n' + validUntrackedDiffs.join('\n'));
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
                            } catch {
                                return '';
                            }
                        })
                );
                const validDeletedDiffs = deletedDiff.filter(diff => diff.trim());
                if (validDeletedDiffs.length > 0) {
                    diffs.push('# Deleted files:\n' + validDeletedDiffs.join('\n'));
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
        } catch {
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
            const statusCommand = ['status', '--porcelain'];
            const output = await this.executeGitCommand(statusCommand, repoPath);

            return output.split('\n')
                .filter(line => line.trim() !== '')
                .filter(line => {
                    if (line.includes('Subproject commit') || line.includes('Entering')) {
                        return false;
                    }

                    if (onlyStaged) {
                        // For staged changes, check first character
                        return STAGED_STATUS_CODES.includes(line[0] as GitStatusCode);
                    }
                    // For all changes, check both staged and unstaged status
                    const [staged, unstaged] = [line[0], line[1]];
                    return staged !== ' ' || unstaged !== ' ';
                })
                .map(line => {
                    const status = line.substring(0, 2);
                    let filePath = line.substring(3).trim();

                    // Handle renamed files (they have format "R100 old-name -> new-name")
                    if (status.startsWith('R')) {
                        filePath = filePath.split(' -> ')[1];
                    }

                    // Log file status for debugging
                    void Logger.log(`File ${filePath} has status: ${status}`);

                    // Return relative path as git status returns it
                    return filePath;
                });
        } catch (error) {
            void Logger.error('Error getting changed files:', error as Error);
            return [];
        }
    }

    private static async executeGitCommand(args: string[], cwd: string): Promise<string> {
        const { stdout, stderr } = await this.execGit(args, cwd);
        if (stderr) {
            throw new Error(stderr);
        }
        return stdout;
    }

    static async getRepositories(): Promise<vscode.SourceControl[]> {
        try {
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
        } catch {
            throw new GitExtensionNotFoundError();
        }
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

    public static async isNewFile(filePath: string, repoPath: string): Promise<boolean> {
        const normalizedPath = path.normalize(filePath.replace(/^\/+/, ''));
        const { stdout } = await this.execGit(['status', '--porcelain', normalizedPath], repoPath);
        const status = stdout.slice(0, 2);
        return status === '??' || status === 'A ';
    }

    public static async isFileDeleted(filePath: string, repoPath: string): Promise<boolean> {
        const normalizedPath = path.normalize(filePath.replace(/^\/+/, ''));
        const { stdout } = await this.execGit(['status', '--porcelain', normalizedPath], repoPath);
        const status = stdout.slice(0, 2);
        return status === ' D' || status === 'D ';
    }

    private static calculateFileHash(content: string): string {
        // Simple hash calculation for git index
        const hash = Buffer.from(content).toString('base64');
        return hash.substring(0, 7);
    }
}

interface GitExtension {
    getAPI(version: 1): {
        repositories: vscode.SourceControl[];
    };
}
