import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage } from '../models/types';
import { GitService, isIndexStaged, isStagedStatus } from './gitService';
import { GitBlameAnalyzer } from './gitBlameAnalyzer';
import { TelemetryService } from './telemetryService';
import { AIService } from './aiService';
import { ApiKeyManager } from './apiKeyManager';
import { UserCancelledError, ApiKeyInvalidError } from '../models/errors';
import { toError, sanitizeErrorForTelemetry } from '../utils/errorUtils';
import { mapLimit } from '../utils/concurrency';
import { extractRef } from '../utils/refUtils';
import { RefStore } from './refStore';

const BLAME_CONCURRENCY = 8;
const MAX_API_KEY_RETRIES = 3;

export class CommitWorkflow {
    static async generateAndSetCommitMessage(
        sourceControlRepository?: vscode.SourceControl,
        apiKeyRetryCount: number = 0,
    ): Promise<void> {
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
            if (ApiKeyManager.requiresKeyForCurrentConfig(provider)) {
                await this.ensureApiKey(provider);
            }

            // Resolve the ref before generation (may show an input box for the
            // 'prompt' source) so the progress UI stays clean.
            const ref = await this.resolveRef(sourceControlRepository);

            await this.executeWithProgress(async (progress, token) => {
                // Check for cancellation
                if (token.isCancellationRequested) {
                    throw new UserCancelledError();
                }

                const controller = new AbortController();
                const cancelSubscription = token.onCancellationRequested(() => {
                    controller.abort();
                });
                try {
                    const commitMessage = await this.generateAndApplyMessage(
                        progress,
                        sourceControlRepository!,
                        token,
                        controller.signal,
                        ref
                    );
                    Logger.log(`Commit message generated: ${commitMessage.message}`);
                } finally {
                    cancelSubscription.dispose();
                }
            });
        } catch (error: unknown) {
            // Don't show error for user cancellation
            if (error instanceof UserCancelledError) {
                Logger.log('Operation cancelled by user');
                return;
            }

            if (error instanceof ApiKeyInvalidError) {
                Logger.error('Invalid API key', error);
                if (apiKeyRetryCount >= MAX_API_KEY_RETRIES) {
                    Logger.error('Max API key retries reached', error);
                    await this.handleError(new Error(
                        vscode.l10n.t('Invalid or expired API key. Maximum retry attempts reached.'),
                    ));
                    return;
                }
                const provider = ConfigService.getProvider();
                await this.handleInvalidApiKey(provider, sourceControlRepository, apiKeyRetryCount);
                return;
            }

            const err = toError(error);
            TelemetryService.sendEvent({
                name: 'message_generation_failed',
                ...sanitizeErrorForTelemetry(err),
                provider: ConfigService.getProvider(),
                model: ConfigService.getModel(),
            });
            await this.handleError(err);
        }
    }

    private static async ensureApiKey(provider: string): Promise<void> {
        await ApiKeyManager.getKey(provider);
    }

    private static async resolveRef(repository?: vscode.SourceControl): Promise<string> {
        if (!ConfigService.get('commit.refs.enabled')) {
            return '';
        }

        const source = ConfigService.get('commit.refs.source');

        if (source === 'branch') {
            const repoPath = repository?.rootUri?.fsPath ?? '';
            const branch = await GitService.getBranchName(repoPath);
            return extractRef(branch, ConfigService.get('commit.refs.branchPattern')) ?? '';
        }

        if (source === 'input') {
            // Branch-specific saved ref (workspaceState) wins over the
            // project-wide ref (commit.refs.value) — more specific scope first.
            const repoPath = repository?.rootUri?.fsPath ?? '';
            const branch = await GitService.getBranchName(repoPath);
            const branchRef = branch ? RefStore.getBranchRef(branch) : undefined;
            return (branchRef ?? ConfigService.get('commit.refs.value')).trim();
        }

        // source === 'prompt'
        const ref = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter a ref (e.g., issue or ticket number) to add to the commit message'),
            placeHolder: vscode.l10n.t('e.g. #123, JIRA-456'),
            ignoreFocusOut: true
        });

        // Escape cancels the whole operation
        if (ref === undefined) {
            throw new UserCancelledError();
        }

        return ref.trim();
    }

    private static async handleInvalidApiKey(
        provider: string,
        sourceControlRepository?: vscode.SourceControl,
        apiKeyRetryCount: number = 0,
    ): Promise<void> {
        await Logger.showError(
            vscode.l10n.t('Invalid or expired API key. Please enter a new one.'),
        );

        try {
            await ApiKeyManager.removeKey(provider);
            await ApiKeyManager.promptForKey(provider);

            Logger.log('API key updated, retrying commit message generation');
            await this.generateAndSetCommitMessage(sourceControlRepository, apiKeyRetryCount + 1);
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
                title: vscode.l10n.t('Commit Sage'),
                cancellable: true
            },
            action
        );
    }

    private static async generateAndApplyMessage(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        sourceControlRepository: vscode.SourceControl,
        token: vscode.CancellationToken,
        signal: AbortSignal,
        ref: string
    ): Promise<CommitMessage> {
        progress.report({ message: vscode.l10n.t('Analyzing changes…'), increment: 10 });

        if (token.isCancellationRequested) {
            throw new UserCancelledError();
        }

        if (!sourceControlRepository?.rootUri) {
            throw new Error('No Git repository found');
        }

        const repoPath = sourceControlRepository.rootUri.fsPath;
        const onlyStagedSetting = ConfigService.get('commit.onlyStagedChanges');
        // One `git status --porcelain` pass drives the staged-vs-all decision
        // AND the per-file blame list, replacing a separate hasChanges('staged')
        // probe and a second getChangedFiles call.
        const allChangedFiles = await GitService.getChangedFiles(repoPath, false, signal);
        const hasStagedChanges = allChangedFiles.some(file => isIndexStaged(file.status));
        const useStagedChanges = onlyStagedSetting || hasStagedChanges;

        if (token.isCancellationRequested) {
            throw new UserCancelledError();
        }

        const diff = await GitService.getDiff(repoPath, useStagedChanges, hasStagedChanges, signal);
        if (!diff) {
            throw new Error('No changes to commit');
        }

        const changedFiles = useStagedChanges
            ? allChangedFiles.filter(file => isStagedStatus(file.status))
            : allChangedFiles;
        // hasHead is constant for the repo this run — resolve once instead of
        // per blame fan-out call.
        const hasHead = await GitService.hasHead(repoPath, signal);
        const blameAnalyses = await mapLimit(
            changedFiles,
            BLAME_CONCURRENCY,
            (file) => GitBlameAnalyzer.analyzeChanges(repoPath, file.path, file.status, useStagedChanges, signal, hasHead),
            signal,
        );
        const blameAnalysis = blameAnalyses.filter(Boolean).join('\n\n');

        if (token.isCancellationRequested) {
            throw new UserCancelledError();
        }

        const commitMessage = await AIService.generateCommitMessage(repoPath, diff, blameAnalysis, progress, {
            fileCount: changedFiles.length,
            onlyStagedChanges: useStagedChanges,
            signal,
        });

        let finalMessage = commitMessage.message;
        if (ref) {
            switch (ConfigService.get('commit.refs.placement')) {
                case 'prefix':
                    // Same first line, before the subject: "PROJ-1 feat: …"
                    finalMessage = `${ref} ${finalMessage}`;
                    break;
                case 'start':
                    // Own line above the message.
                    finalMessage = `${ref}\n\n${finalMessage}`;
                    break;
                default:
                    // 'end' — own line below the message.
                    finalMessage = `${finalMessage}\n\n${ref}`;
            }
        }

        sourceControlRepository.inputBox.value = finalMessage;

        if (ConfigService.get('commit.autoCommit')) {
            await this.handleAutoCommit(sourceControlRepository);
        }

        return { ...commitMessage, message: finalMessage };
    }

    private static async handleError(error: Error): Promise<void> {
        Logger.error('Error in CommitWorkflow:', error);
        await vscode.window.showErrorMessage(vscode.l10n.t('Commit Sage: {0}', error.message));
    }

    private static async handleAutoCommit(repository: vscode.SourceControl): Promise<void> {
        try {
            if (!repository.inputBox.value) {
                throw new Error('No commit message available');
            }

            await GitService.commitChanges(repository.inputBox.value, repository);

            if (ConfigService.get('commit.autoPush')) {
                await GitService.pushChanges(repository);
            }
        } catch (error) {
            Logger.error('Auto-commit/push failed:', toError(error));
            throw error;
        }
    }
}
