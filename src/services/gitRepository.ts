import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  GitExtensionNotFoundError,
  NoRepositoriesFoundError,
  NoRepositorySelectedError,
} from '../models/errors';

interface GitExtension {
  getAPI(version: 1): {
    repositories: vscode.SourceControl[];
  };
}

/**
 * Owns integration with VS Code's built-in `vscode.git` extension: activating
 * it, enumerating repositories, and picking the one a command should act on
 * (explicit argument → single repo → repo of the active editor → user pick).
 */
export class GitRepositoryProvider {
  static async validateGitExtension(): Promise<void> {
    const extension =
      vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      throw new GitExtensionNotFoundError();
    }
    await extension.activate();
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
        : vscode.l10n.t('Unknown repository'),
      description: repo.rootUri ? repo.rootUri.fsPath : undefined,
      repository: repo,
    }));

    const selected = await vscode.window.showQuickPick(repoOptions, {
      placeHolder: vscode.l10n.t('Select the repository to generate commit message'),
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
}
