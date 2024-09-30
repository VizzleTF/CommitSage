import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { Logger } from './logger';
import {
    GitExtensionNotFoundError,
    NoRepositoriesFoundError,
    NoChangesDetectedError,
    NoRepositorySelectedError
} from './errors';

export class GitService {
    static async getDiff(repoPath: string): Promise<string> {
        Logger.log(`Getting diff for repository: ${repoPath}`);
        const diff = await this.executeGitCommand(['diff'], repoPath);
        if (!diff.trim()) throw new NoChangesDetectedError();
        return diff;
    }

    private static executeGitCommand(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const childProcess = spawn('git', args, { cwd });
            let stdout = '';
            let stderr = '';

            childProcess.stdout.on('data', (data) => { stdout += data; });
            childProcess.stderr.on('data', (data) => { stderr += data; });
            childProcess.on('close', (code) => {
                code !== 0
                    ? reject(new Error(`Git ${args.join(' ')} failed with code ${code}: ${stderr}`))
                    : resolve(stdout);
            });
        });
    }

    static async getRepositories(): Promise<vscode.SourceControl[]> {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) throw new GitExtensionNotFoundError();

        const git = gitExtension.exports.getAPI(1);
        const repos = git.repositories;
        if (repos.length === 0) throw new NoRepositoriesFoundError();

        return repos;
    }

    static async selectRepository(repos: vscode.SourceControl[]): Promise<vscode.SourceControl> {
        if (repos.length === 1) return repos[0];

        const repoOptions = repos.map(repo => ({
            label: repo.rootUri ? repo.rootUri.fsPath : 'Unknown repository path',
            repository: repo
        }));

        const selected = await vscode.window.showQuickPick(repoOptions, {
            placeHolder: 'Select the repository to generate commit message'
        });

        if (!selected) throw new NoRepositorySelectedError();
        return selected.repository;
    }

    static async getChangedFiles(repoPath: string): Promise<string[]> {
        const output = await this.executeGitCommand(['status', '--porcelain'], repoPath);
        return output.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => line.substring(3).trim());
    }
}

interface GitExtension {
    getAPI(version: number): GitAPI;
}

interface GitAPI {
    repositories: vscode.SourceControl[];
}