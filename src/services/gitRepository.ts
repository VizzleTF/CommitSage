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
  private static async activateGitApi(): Promise<GitExtension> {
    const extension =
      vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      throw new GitExtensionNotFoundError();
    }
    return extension.activate();
  }

  static async validateGitExtension(): Promise<void> {
    await this.activateGitApi();
  }

  static async getRepositories(): Promise<vscode.SourceControl[]> {
    const git = (await this.activateGitApi()).getAPI(1);

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

    // The innermost repo containing the active file: a separator-bounded
    // prefix (so /w/app does not claim /w/app-web) and the longest root wins
    // (so a submodule beats its parent).
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    let activeRepo: vscode.SourceControl | undefined;
    for (const repo of repos) {
      const root = repo.rootUri?.fsPath;
      if (
        activeFile && root &&
        (activeFile === root || activeFile.startsWith(root + path.sep)) &&
        root.length > (activeRepo?.rootUri?.fsPath.length ?? -1)
      ) {
        activeRepo = repo;
      }
    }

    return activeRepo ?? this.selectRepository(repos);
  }
}
