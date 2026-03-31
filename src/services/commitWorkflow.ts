import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage } from '../models/types';
import { GitService } from './gitService';
import { GitBlameAnalyzer } from './gitBlameAnalyzer';
import { TelemetryService } from './telemetryService';
import { AIService } from './aiService';
import { ApiKeyManager } from './apiKeyManager';
import { UserCancelledError, ApiKeyInvalidError } from '../models/errors';
import { toError, sanitizeErrorForTelemetry } from '../utils/errorUtils';

export class CommitWorkflow {
    static async generateAndSetCommitMessage(sourceControlRepository?: vscode.SourceControl): Promise<void> {
        try {
            await this.initializeAndValidate();

            if (!sourceControlRepository) {
                const repos = await GitService.getRepositories();
                if (repos.length === 1) {
                    sourceControlRepository = repos[0];
                } else {
                    sourceControlRepository = await GitService.selectRepository(repos);
                }
            }

            // Pre-check API key if required for the provider
            const provider = ConfigService.getProvider();
            const needsApiKey = ApiKeyManager.requiresApiKey(provider) &&
                (provider !== 'ollama' || ConfigService.getOllamaUseAuthToken());
            if (needsApiKey) {
                await this.ensureApiKey(provider);
            }

            await this.executeWithProgress(async (progress, token) => {
                // Check for cancellation
                if (token.isCancellationRequested) {
                    throw new UserCancelledError();
                }

                const commitMessage = await this.generateAndApplyMessage(progress, sourceControlRepository!, token);
                Logger.log(`Commit message generated: ${commitMessage.message}`);
            });
        } catch (error: unknown) {
            // Don't show error for user cancellation
            if (error instanceof UserCancelledError) {
                Logger.log('Operation cancelled by user');
                return;
            }

            if (error instanceof ApiKeyInvalidError) {
                Logger.error('Invalid API key', error);
                const provider = ConfigService.getProvider();
                await this.handleInvalidApiKey(provider, sourceControlRepository);
                return;
            }

            const err = toError(error);
            TelemetryService.sendEvent({
                name: 'message_generation_failed',
                ...sanitizeErrorForTelemetry(err),
                provider: ConfigService.getProvider(),
            });
            await this.handleError(err);
        }
    }

    private static async ensureApiKey(provider: string): Promise<void> {
        await ApiKeyManager.getKey(provider);
    }

    private static async handleInvalidApiKey(provider: string, sourceControlRepository?: vscode.SourceControl): Promise<void> {
        await Logger.showError(
            'Invalid or expired API key. Please enter a new one.',
        );

        try {
            await ApiKeyManager.removeKey(provider);
            await ApiKeyManager.promptForKey(provider);

            Logger.log('API key updated, retrying commit message generation');
            await this.generateAndSetCommitMessage(sourceControlRepository);
        } catch (error) {
            if (error instanceof UserCancelledError) {
                Logger.log('User cancelled API key update');
            }
        }
    }

    private static async initializeAndValidate(): Promise<void> {
        if (!vscode.workspace.workspaceFolders) {
            throw new Error('No workspace folder is open');
        }
    }

    private static async executeWithProgress(
        action: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Promise<void>
    ): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'CommitSage',
                cancellable: true
            },
            action
        );
    }

    private static async generateAndApplyMessage(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        sourceControlRepository: vscode.SourceControl,
        token: vscode.CancellationToken
    ): Promise<CommitMessage> {
        progress.report({ message: "Analyzing changes...", increment: 10 });

        if (token.isCancellationRequested) {
            throw new UserCancelledError();
        }

        if (!sourceControlRepository?.rootUri) {
            throw new Error('No Git repository found');
        }

        const repoPath = sourceControlRepository.rootUri.fsPath;
        const onlyStagedSetting = ConfigService.getOnlyStagedChanges();
        const hasStagedChanges = await GitService.hasChanges(repoPath, 'staged');
        const useStagedChanges = onlyStagedSetting || hasStagedChanges;

        if (token.isCancellationRequested) {
            throw new UserCancelledError();
        }

        const diff = await GitService.getDiff(repoPath, useStagedChanges, hasStagedChanges);
        if (!diff) {
            throw new Error('No changes to commit');
        }

        const changedFiles = await GitService.getChangedFiles(repoPath, useStagedChanges);
        const blameAnalyses = await Promise.all(
            changedFiles.map(file => GitBlameAnalyzer.analyzeChanges(repoPath, file))
        );
        const blameAnalysis = blameAnalyses.filter(analysis => analysis).join('\n\n');

        if (token.isCancellationRequested) {
            throw new UserCancelledError();
        }

        const commitMessage = await AIService.generateCommitMessage(diff, blameAnalysis, progress, {
            fileCount: changedFiles.length,
            onlyStagedChanges: useStagedChanges,
        });

        sourceControlRepository.inputBox.value = commitMessage.message;

        if (ConfigService.getAutoCommitEnabled()) {
            await this.handleAutoCommit(sourceControlRepository);
        }

        return commitMessage;
    }

    private static async handleError(error: Error): Promise<void> {
        Logger.error('Error in CommitWorkflow:', error);
        await vscode.window.showErrorMessage(`CommitSage: ${error.message}`);
    }

    private static async handleAutoCommit(repository: vscode.SourceControl): Promise<void> {
        try {
            if (!repository.inputBox.value) {
                throw new Error('No commit message available');
            }

            await GitService.commitChanges(repository.inputBox.value, repository);

            if (ConfigService.getAutoPushEnabled()) {
                await GitService.pushChanges(repository);
            }
        } catch (error) {
            Logger.error('Auto-commit/push failed:', toError(error));
            throw error;
        }
    }
}
