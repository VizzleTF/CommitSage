import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Logger } from '../utils/logger';
import {
    GitExtensionNotFoundError,
    NoRepositoriesFoundError,
    NoChangesDetectedError,
    NoRepositorySelectedError
} from '../models/errors';

export class GitService {
    private static sourceControl: vscode.SourceControl;
    private static indexGroup: vscode.SourceControlResourceGroup;
    private static workingTreeGroup: vscode.SourceControlResourceGroup;

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.sourceControl = vscode.scm.createSourceControl('geminicommit', 'GeminiCommit');
        this.indexGroup = this.sourceControl.createResourceGroup('index', 'Staged Changes');
        this.workingTreeGroup = this.sourceControl.createResourceGroup('workingTree', 'Changes');

        // Set up input box for commit messages
        this.sourceControl.inputBox.placeholder = 'Type commit message (Ctrl+Enter to commit)';

        // Handle commit action when user presses Ctrl+Enter
        this.sourceControl.acceptInputCommand = {
            command: 'geminicommit.acceptInput',
            title: 'Accept Input',
            tooltip: 'Commit changes'
        };

        context.subscriptions.push(this.sourceControl);

        // Initial refresh of resource states
        await this.refreshSourceControl();
    }

    private static async refreshSourceControl(): Promise<void> {
        try {
            const repo = await this.getActiveRepository();
            if (!repo?.rootUri) return;

            const [indexStates, workingStates] = await Promise.all([
                this.getStagedResourceStates(repo.rootUri.fsPath),
                this.getUnstagedResourceStates(repo.rootUri.fsPath)
            ]);

            this.indexGroup.resourceStates = indexStates;
            this.workingTreeGroup.resourceStates = workingStates;
        } catch (error) {
            void Logger.error('Failed to refresh source control:', error as Error);
        }
    }

    private static async getStagedResourceStates(repoPath: string): Promise<vscode.SourceControlResourceState[]> {
        const diff = await this.executeGitCommand(['diff', '--staged', '--name-status'], repoPath);
        return this.parseGitStatus(diff, repoPath, true);
    }

    private static async getUnstagedResourceStates(repoPath: string): Promise<vscode.SourceControlResourceState[]> {
        const diff = await this.executeGitCommand(['diff', '--name-status'], repoPath);
        return this.parseGitStatus(diff, repoPath, false);
    }

    private static parseGitStatus(
        output: string,
        repoPath: string,
        staged: boolean
    ): vscode.SourceControlResourceState[] {
        return output.split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [status, ...filePaths] = line.split('\t');
                const filePath = filePaths.join('\t');

                return {
                    resourceUri: vscode.Uri.file(`${repoPath}/${filePath}`),
                    decorations: {
                        strikeThrough: status === 'D',
                        tooltip: this.getStatusText(status),
                        light: { iconPath: this.getIconPath(status) },
                        dark: { iconPath: this.getIconPath(status) }
                    },
                    command: {
                        command: staged ? 'git.unstage' : 'git.stage',
                        title: staged ? 'Unstage Changes' : 'Stage Changes',
                        arguments: [vscode.Uri.file(`${repoPath}/${filePath}`)]
                    }
                };
            });
    }

    static async getDiff(repoPath: string, onlyStaged: boolean = false): Promise<string> {
        void Logger.log(`Getting diff for repository: ${repoPath}, onlyStaged: ${onlyStaged}`);

        const stagedDiff = await this.executeGitCommand(['diff', '--staged'], repoPath);

        if (stagedDiff.trim()) {
            return stagedDiff;
        }

        if (onlyStaged) {
            throw new NoChangesDetectedError('No staged changes detected.');
        }

        const unstaged = await this.executeGitCommand(['diff'], repoPath);
        const untrackedFiles = await this.getUntrackedFiles(repoPath);

        let untrackedContent = '';
        if (untrackedFiles.length > 0) {
            for (const file of untrackedFiles) {
                untrackedContent += `diff --git a/${file} b/${file}\n`;
                untrackedContent += `new file mode 100644\n`;
                untrackedContent += `--- /dev/null\n`;
                untrackedContent += `+++ b/${file}\n`;

                try {
                    const fileContent = await this.executeGitCommand(['show', `:${file}`], repoPath).catch(() => '');
                    if (fileContent) {
                        untrackedContent += fileContent.split('\n')
                            .map(line => `+${line}`)
                            .join('\n');
                        untrackedContent += '\n';
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    void Logger.log(`Error reading content of ${file}: ${errorMessage}`);
                }
            }
        }

        const combinedDiff = unstaged + (untrackedContent ? '\n' + untrackedContent : '');

        if (!combinedDiff.trim()) {
            throw new NoChangesDetectedError('No changes detected.');
        }

        return combinedDiff;
    }

    private static async getUntrackedFiles(repoPath: string): Promise<string[]> {
        const command = ['ls-files', '--others', '--exclude-standard'];
        const output = await this.executeGitCommand(command, repoPath);
        return output.split('\n').filter(line => line.trim() !== '');
    }

    private static executeGitCommand(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const childProcess = spawn('git', args, { cwd });
            let stdout = '';
            let stderr = '';

            childProcess.stdout.on('data', (data) => { stdout += data; });
            childProcess.stderr.on('data', (data) => { stderr += data; });
            childProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Git ${args.join(' ')} failed with code ${code}: ${stderr}`));
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

    static async getChangedFiles(repoPath: string, onlyStaged: boolean = false): Promise<string[]> {
        const statusCommand = ['status', '--porcelain'];
        const output = await this.executeGitCommand(statusCommand, repoPath);
        return output.split('\n')
            .filter(line => line.trim() !== '')
            .filter(line => !onlyStaged || line[0] === 'M' || line[0] === 'A' || line[0] === 'D' || line[0] === 'R')
            .map(line => line.substring(3).trim());
    }

    static async hasStagedChanges(repoPath: string): Promise<boolean> {
        try {
            const statusOutput = await this.executeGitCommand(['status', '--porcelain'], repoPath);
            return statusOutput.split('\n').some(line =>
                line.trim() !== '' && ['M', 'A', 'D', 'R'].includes(line[0])
            );
        } catch (error) {
            void Logger.error('Error checking staged changes:', error as Error);
            return false;
        }
    }

    static async hasUntrackedFiles(repoPath: string): Promise<boolean> {
        try {
            const statusOutput = await this.executeGitCommand(['status', '--porcelain'], repoPath);
            return statusOutput.split('\n').some(line =>
                line.trim() !== '' && line.startsWith('??')
            );
        } catch (error) {
            void Logger.error('Error checking untracked files:', error as Error);
            return false;
        }
    }

    static async commitChanges(repo: vscode.SourceControl, message: string): Promise<void> {
        const repoPath = repo.rootUri?.fsPath;
        if (!repoPath) {
            throw new Error('Repository path is undefined');
        }

        try {
            const hasStagedChanges = await this.hasStagedChanges(repoPath);
            const hasUntrackedFiles = await this.hasUntrackedFiles(repoPath);

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
            void Logger.log('Changes committed successfully');
        } catch (error) {
            void Logger.error('Failed to commit changes:', error as Error);
            throw error;
        }
    }

    static async pushChanges(repo: vscode.SourceControl): Promise<void> {
        return new Promise((resolve, reject) => {
            const childProcess = spawn('git', ['push'], {
                cwd: repo.rootUri?.fsPath
            });

            childProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Git push failed with code ${code}`));
                }
            });
        });
    }

    static async checkGitConfig(repoPath: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                const userName = await this.executeGitCommand(['config', 'user.name'], repoPath);
                const userEmail = await this.executeGitCommand(['config', 'user.email'], repoPath);

                if (!userName.trim() || !userEmail.trim()) {
                    reject(new Error('Git user.name or user.email is not configured.'));
                } else {
                    resolve();
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    static async validateGitExtension(): Promise<void> {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!extension) {
            throw new GitExtensionNotFoundError();
        }
        await extension.activate();
    }

    private static getStatusText(status: string): string {
        switch (status[0]) {
            case 'A': return 'Added';
            case 'M': return 'Modified';
            case 'D': return 'Deleted';
            case 'R': return 'Renamed';
            case 'C': return 'Copied';
            case 'U': return 'Updated';
            default: return 'Unknown';
        }
    }

    private static getIconPath(status: string): vscode.ThemeIcon {
        switch (status[0]) {
            case 'A': return new vscode.ThemeIcon('diff-added');
            case 'M': return new vscode.ThemeIcon('diff-modified');
            case 'D': return new vscode.ThemeIcon('diff-removed');
            case 'R': return new vscode.ThemeIcon('diff-renamed');
            default: return new vscode.ThemeIcon('diff-modified');
        }
    }

    private static async getActiveRepository(): Promise<vscode.SourceControl | undefined> {
        const repos = await this.getRepositories();
        if (repos.length === 1) {
            return repos[0];
        }
        return this.selectRepository(repos);
    }
}

interface GitExtension {
    getAPI(version: 1): {
        repositories: vscode.SourceControl[];
    };
}