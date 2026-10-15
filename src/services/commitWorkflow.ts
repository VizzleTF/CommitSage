import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage } from '../models/types';
import { GitService, isIndexStaged } from './gitService';
import { GitRepositoryProvider } from './gitRepository';
import { GitBlameAnalyzer } from './gitBlameAnalyzer';
import { TelemetryService } from './telemetryService';
import { AIService } from './aiService';
import { ApiKeyManager } from './apiKeyManager';
import { UserCancelledError, ApiKeyInvalidError } from '../models/errors';
import { toError, sanitizeErrorForTelemetry } from '../utils/errorUtils';
import { GIT_FANOUT_CONCURRENCY, mapLimit } from '../utils/concurrency';
import { applyRef, extractRef } from '../utils/refUtils';
import { RefStore } from './refStore';

const MAX_API_KEY_RETRIES = 3;

export class CommitWorkflow {
    static async generateAndSetCommitMessage(
        sourceControlRepository?: vscode.SourceControl,
        apiKeyRetryCount: number = 0,
    ): Promise<void> {
        try {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder is open');
            }

            // Reassigned so the invalid-API-key retry reuses the picked repo.
            sourceControlRepository = await GitRepositoryProvider.getActiveRepository(sourceControlRepository);

            // Pre-check API key if required for the provider
            const provider = ConfigService.getProvider();
            if (ApiKeyManager.requiresKeyForCurrentConfig(provider)) {
                await ApiKeyManager.getKey(provider);
            }

            // Resolve the ref before generation (may show an input box for the
            // 'prompt' source) so the progress UI stays clean.
            const ref = await this.resolveRef(sourceControlRepository);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Commit Sage'),
                cancellable: true,
            }, async (progress, token) => {
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
                } catch (error) {
                    // Anything that fails *after* the user hit Cancel is a
                    // symptom of the abort, not a real failure: git spawns and
                    // fetch both reject with AbortError, and Gemini's auto mode
                    // walks the rest of its fallback list first. Left as-is the
                    // user gets an error popup ("operation was aborted") plus a
                    // message_generation_failed telemetry event for their own
                    // cancellation.
                    if (controller.signal.aborted && !(error instanceof UserCancelledError)) {
                        throw new UserCancelledError();
                    }
                    throw error;
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
                // The key is not sent while its toggle is off: asking for a new
                // one would only repeat the 401.
                if (!ApiKeyManager.requiresKeyForCurrentConfig(provider)) {
                    await this.handleError(new Error(vscode.l10n.t(
                        '{0} returned 401. Turn on commitSage.{1} and set the token.',
                        provider,
                        provider === 'ollama' ? 'ollama.useAuthToken' : 'custom.useApiKey',
                    )));
                    return;
                }
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

    private static async resolveRef(repository?: vscode.SourceControl): Promise<string> {
        if (!ConfigService.get('commit.refs.enabled')) {
            return '';
        }

        const source = ConfigService.get('commit.refs.source');

        if (source === 'branch' || source === 'input') {
            const branch = await GitService.getBranchName(repository?.rootUri?.fsPath ?? '');
            if (source === 'branch') {
                return extractRef(branch, ConfigService.get('commit.refs.branchPattern')) ?? '';
            }
            // Branch-specific saved ref (workspaceState) wins over the
            // project-wide ref (commit.refs.value) — more specific scope first.
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
            } else {
                await this.handleError(toError(error));
            }
        }
    }

    private static async generateAndApplyMessage(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        sourceControlRepository: vscode.SourceControl,
        token: vscode.CancellationToken,
        signal: AbortSignal,
        ref: string
    ): Promise<CommitMessage> {
        progress.report({ message: vscode.l10n.t('Analyzing changes…'), increment: 10 });

        if (!sourceControlRepository?.rootUri) {
            throw new Error('No Git repository found');
        }

        const repoPath = sourceControlRepository.rootUri.fsPath;
        // One `git status --porcelain` pass drives the staged-vs-worktree
        // decision AND the per-file blame list.
        const allChangedFiles = await GitService.getChangedFiles(repoPath, signal);
        const hasStagedChanges = allChangedFiles.some(file => isIndexStaged(file.status));
        const useStagedChanges = ConfigService.get('commit.onlyStagedChanges') || hasStagedChanges;

        const diff = await GitService.getDiff(repoPath, useStagedChanges, signal);

        const changedFiles = useStagedChanges
            ? allChangedFiles.filter(file => isIndexStaged(file.status))
            : allChangedFiles;
        // Blame reads HEAD, so a repo without commits has nothing to blame.
        const blameAnalyses = await GitService.hasHead(repoPath, signal)
            ? await mapLimit(
                changedFiles,
                GIT_FANOUT_CONCURRENCY,
                (file) => GitBlameAnalyzer.analyzeChanges(repoPath, file.path, file.status, useStagedChanges, signal),
                signal,
            )
            : [];
        const blameAnalysis = blameAnalyses.filter(Boolean).join('\n');

        if (token.isCancellationRequested) {
            throw new UserCancelledError();
        }

        const commitMessage = await AIService.generateCommitMessage(repoPath, diff, blameAnalysis, progress, {
            fileCount: changedFiles.length,
            onlyStagedChanges: useStagedChanges,
            signal,
        });

        const finalMessage = applyRef(commitMessage.message, ref, ConfigService.get('commit.refs.placement'));
        sourceControlRepository.inputBox.value = finalMessage;

        if (ConfigService.get('commit.autoCommit')) {
            try {
                // Nothing was staged when the message was generated, so the commit
                // has to stage the whole worktree to match what the message says.
                await this.handleAutoCommit(finalMessage, repoPath, !useStagedChanges);
            } catch (error) {
                // GitService already sent commit_failed / push_failed; this is
                // not a generation failure. Not awaited: the progress
                // notification would stay open until the error is dismissed.
                void this.handleError(toError(error));
            }
        }

        return { ...commitMessage, message: finalMessage };
    }

    private static async handleError(error: Error): Promise<void> {
        Logger.error('Error in CommitWorkflow:', error);
        await vscode.window.showErrorMessage(vscode.l10n.t('Commit Sage: {0}', error.message));
    }

    private static async handleAutoCommit(
        message: string,
        repoPath: string,
        stageAll: boolean,
    ): Promise<void> {
        // Last line of defense for the "a repo turns on auto-commit for you"
        // case. `restrictedConfigurations` covers the settings store and
        // `ConfigService` gates `.commitsage/config.json`, but writing to the
        // user's repo without their click is the one action worth checking at
        // the sink as well.
        if (!vscode.workspace.isTrusted) {
            Logger.warn('Auto-commit skipped: the workspace is not trusted.');
            return;
        }

        await GitService.commitChanges(message, repoPath, stageAll);

        if (ConfigService.get('commit.autoPush')) {
            await GitService.pushChanges(repoPath);
        }
    }
}
