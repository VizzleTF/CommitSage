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
import { toError, sanitizeErrorForTelemetry, categorizeError } from '../utils/errorUtils';
import { GIT_FANOUT_CONCURRENCY, mapLimit } from '../utils/concurrency';
import { applyRef, extractRef } from '../utils/refUtils';
import { RefStore } from './refStore';
import { providerMeta } from './providerCatalog';
import { AIServiceFactory } from './aiServiceFactory';
import { generateSplitPrompt, parseSplitPlan } from './commitSplitter';
import { blockPath, resolveMaxDiffLength, splitIntoFileBlocks, truncateDiff } from '../utils/diffTruncation';
import { redactDiffSecrets } from '../utils/errorUtils';

const MAX_API_KEY_RETRIES = 3;

export class CommitWorkflow {
    // Last message written to each repository's commit box this session, so
    // a re-run does not take Commit Sage's own output for the developer's draft.
    private static readonly lastGenerated = new Map<string, string>();
    // Root URIs of the repositories with a run in progress, in the form of the
    // `scmProviderRootUri` context key that the command's `enablement` checks.
    private static readonly running = new Set<string>();

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

            const runKey = sourceControlRepository.rootUri?.toString() ?? '';
            if (this.running.has(runKey)) {
                void vscode.window.showInformationMessage(vscode.l10n.t(
                    'Commit Sage is already generating a message for this repository.',
                ));
                return;
            }
            this.setRunning(runKey, true);
            try {
                await this.generateWithProgress(sourceControlRepository);
            } finally {
                // Released before the catch below: the invalid-key retry starts a run of its own.
                this.setRunning(runKey, false);
            }
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
                        { cause: error },
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

    /**
     * Groups the changed files into logical commits with the model, writes a
     * message for each group and, once the developer confirms the plan,
     * commits the groups one after another.
     */
    static async splitAndCommit(sourceControlRepository?: vscode.SourceControl): Promise<void> {
        let runKey: string | undefined;
        try {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder is open');
            }
            const repository = await GitRepositoryProvider.getActiveRepository(sourceControlRepository);
            const repoKey = repository.rootUri?.toString() ?? '';
            if (this.running.has(repoKey)) {
                void vscode.window.showInformationMessage(vscode.l10n.t(
                    'Commit Sage is already generating a message for this repository.',
                ));
                return;
            }
            runKey = repoKey;
            this.setRunning(runKey, true);

            const provider = ConfigService.getProvider();
            if (ApiKeyManager.requiresKeyForCurrentConfig(provider)) {
                await ApiKeyManager.getKey(provider);
            }
            const ref = await this.resolveRef(repository);
            const plan = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Commit Sage'),
                cancellable: true,
            }, async (progress, token) => {
                const controller = new AbortController();
                const subscription = token.onCancellationRequested(() => controller.abort());
                try {
                    return await this.planSplit(progress, repository, controller.signal);
                } catch (error) {
                    throw controller.signal.aborted ? new UserCancelledError() : error;
                } finally {
                    subscription.dispose();
                }
            });
            if (plan) {
                await this.commitSplit(plan, repository, ref);
            }
        } catch (error: unknown) {
            if (error instanceof UserCancelledError) {
                Logger.log('Operation cancelled by user');
                return;
            }
            await this.handleError(toError(error));
        } finally {
            if (runKey !== undefined) {
                this.setRunning(runKey, false);
            }
        }
    }

    /** The groups and their messages, or undefined when there is nothing to split. */
    private static async planSplit(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        repository: vscode.SourceControl,
        signal: AbortSignal,
    ): Promise<{ groups: Array<{ paths: string[]; message: CommitMessage }>; staged: boolean } | undefined> {
        progress.report({ message: vscode.l10n.t('Analyzing changes…') });
        const repoPath = repository.rootUri?.fsPath;
        if (!repoPath) {
            throw new Error('No Git repository found');
        }
        const files = await GitService.getChangedFiles(repoPath, signal);
        const staged = ConfigService.get('commit.onlyStagedChanges') || files.some(file => isIndexStaged(file.status));
        const candidates = staged ? files.filter(file => isIndexStaged(file.status)) : files;
        // `git commit -- <path>` takes the worktree state, so it would also
        // commit the unstaged part of a partly staged file.
        if (staged && candidates.some(file => file.status[1] !== ' ')) {
            throw new Error(vscode.l10n.t('Some staged files also have unstaged changes. Stage or stash them before splitting.'));
        }
        if (candidates.length < 2) {
            void vscode.window.showInformationMessage(vscode.l10n.t('Only one file changed, so there is nothing to split.'));
            return undefined;
        }

        const excluded = await GitService.getExcludedPaths(repoPath, signal);
        const diff = redactDiffSecrets(await GitService.getDiff(repoPath, staged, signal, excluded));
        const paths = candidates.map(file => file.path);
        const provider = ConfigService.getProvider();
        const prompt = generateSplitPrompt(paths, truncateDiff(diff, resolveMaxDiffLength(ConfigService.get('general.maxDiffSize'))));
        progress.report({ message: vscode.l10n.t('Grouping changes…') });
        let plan = parseSplitPlan((await AIServiceFactory.generateCommitMessage(provider, prompt, progress, { signal })).message, paths);
        if (!('groups' in plan)) {
            const correction = `\n\nYour previous reply was invalid. Missing files: ${plan.missing.join(', ') || 'none'}. `
                + `Unknown or repeated files: ${plan.unknown.join(', ') || 'none'}. Reply again with every file exactly once.`;
            plan = parseSplitPlan((await AIServiceFactory.generateCommitMessage(provider, prompt + correction, progress, { signal })).message, paths);
        }
        if (!('groups' in plan)) {
            throw new Error(vscode.l10n.t('The model did not return a valid commit plan. Try again or use a stronger model.'));
        }

        const byPath = new Map(candidates.map(file => [file.path, file]));
        const blocks = splitIntoFileBlocks(diff);
        const groups: Array<{ paths: string[]; message: CommitMessage }> = [];
        for (const [i, group] of plan.groups.entries()) {
            progress.report({ message: vscode.l10n.t('Writing commit message {0} of {1}…', i + 1, plan.groups.length) });
            // A rename is committed with its old path, so the deletion goes along.
            const own = group.flatMap(path => [path, byPath.get(path)?.from ?? []].flat());
            const groupDiff = blocks.filter(block => own.includes(blockPath(block))).join('');
            const message = await AIService.generateCommitMessage(repoPath, groupDiff || group.join('\n'), '', progress, {
                fileCount: group.length,
                onlyStagedChanges: staged,
                signal,
            });
            groups.push({ paths: own, message });
        }
        return { groups, staged };
    }

    private static async commitSplit(
        plan: { groups: Array<{ paths: string[]; message: CommitMessage }>; staged: boolean },
        repository: vscode.SourceControl,
        ref: string,
    ): Promise<void> {
        const placement = ConfigService.get('commit.refs.placement');
        const messages = plan.groups.map(group => applyRef(group.message.message, ref, placement));
        const commit = vscode.l10n.t('Commit');
        const answer = await vscode.window.showInformationMessage(
            vscode.l10n.t('Create {0} commits?', plan.groups.length),
            {
                modal: true,
                detail: plan.groups.map((group, i) => `${i + 1}. ${messages[i].split('\n')[0]}\n    ${group.paths.join(', ')}`).join('\n'),
            },
            commit,
        );
        if (answer !== commit) {
            throw new UserCancelledError();
        }
        const repoPath = repository.rootUri?.fsPath ?? '';
        for (const [i, group] of plan.groups.entries()) {
            try {
                await GitService.commitChanges(messages[i], repoPath, !plan.staged, group.message.signOff === true, group.paths);
            } catch (error) {
                throw new Error(vscode.l10n.t('Created {0} of {1} commits. {2}', i, plan.groups.length, toError(error).message), { cause: error });
            }
        }
        void vscode.window.showInformationMessage(vscode.l10n.t('Created {0} commits.', plan.groups.length));
    }

    private static setRunning(runKey: string, running: boolean): void {
        if (running) {
            this.running.add(runKey);
        } else {
            this.running.delete(runKey);
        }
        void vscode.commands.executeCommand('setContext', 'commitsage.generatingRepos', [...this.running]);
    }

    private static async generateWithProgress(sourceControlRepository: vscode.SourceControl): Promise<void> {
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
                    sourceControlRepository,
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
        const boxValue = sourceControlRepository.inputBox.value.trim();
        // The box still holding our own message means a re-run: regenerate.
        const isOwnMessage = boxValue === this.lastGenerated.get(repoPath);
        const draft = isOwnMessage ? '' : boxValue;
        const rejected = isOwnMessage ? boxValue : '';
        // One `git status --porcelain` pass drives the staged-vs-worktree
        // decision AND the per-file blame list.
        const allChangedFiles = await GitService.getChangedFiles(repoPath, signal);
        const hasStagedChanges = allChangedFiles.some(file => isIndexStaged(file.status));
        const useStagedChanges = ConfigService.get('commit.onlyStagedChanges') || hasStagedChanges;

        // Sensitive files reach the model by path only: no diff, no blame.
        const excluded = await GitService.getExcludedPaths(repoPath, signal);
        const diff = await GitService.getDiff(repoPath, useStagedChanges, signal, excluded);

        const changedFiles = useStagedChanges
            ? allChangedFiles.filter(file => isIndexStaged(file.status))
            : allChangedFiles;
        // Blame reads HEAD, so a repo without commits has nothing to blame.
        const blameAnalyses = ConfigService.get('commit.useBlameAsContext') && await GitService.hasHead(repoPath, signal)
            ? await mapLimit(
                changedFiles.filter(file => !excluded.has(file.path)),
                GIT_FANOUT_CONCURRENCY,
                (file) => GitBlameAnalyzer.analyzeChanges(repoPath, file.path, file.status, useStagedChanges, signal),
                signal,
            )
            : [];
        const blameAnalysis = blameAnalyses.filter(Boolean).join('\n');

        if (token.isCancellationRequested) {
            throw new UserCancelledError();
        }

        const suggestions = await AIService.generateCommitMessages(repoPath, diff, blameAnalysis, progress, {
            fileCount: changedFiles.length,
            onlyStagedChanges: useStagedChanges,
            signal,
            draft,
            rejected,
            count: ConfigService.get('commit.suggestionCount'),
        });
        const commitMessage = await this.pickSuggestion(suggestions);

        const finalMessage = applyRef(commitMessage.message, ref, ConfigService.get('commit.refs.placement'));
        sourceControlRepository.inputBox.value = finalMessage;
        this.lastGenerated.set(repoPath, finalMessage.trim());

        if (ConfigService.get('commit.autoCommit')) {
            try {
                // Nothing was staged when the message was generated, so the commit
                // has to stage the whole worktree to match what the message says.
                await this.handleAutoCommit(finalMessage, repoPath, !useStagedChanges, commitMessage.signOff === true);
            } catch (error) {
                // GitService already sent commit_failed / push_failed; this is
                // not a generation failure. Not awaited: the progress
                // notification would stay open until the error is dismissed.
                void this.handleError(toError(error));
            }
        }

        return { ...commitMessage, message: finalMessage };
    }

    /** The only suggestion, or the one the developer picks; Escape cancels. */
    private static async pickSuggestion(suggestions: CommitMessage[]): Promise<CommitMessage> {
        if (suggestions.length === 1) {
            return suggestions[0];
        }
        const picked = await vscode.window.showQuickPick(
            suggestions.map(suggestion => {
                const [subject, ...body] = suggestion.message.split('\n');
                return { label: subject, detail: body.join(' ').trim() || undefined, suggestion };
            }),
            { title: vscode.l10n.t('Pick a commit message'), ignoreFocusOut: true, matchOnDetail: true },
        );
        if (!picked) {
            throw new UserCancelledError();
        }
        return picked.suggestion;
    }

    private static async handleError(error: Error): Promise<void> {
        Logger.error('Error in CommitWorkflow:', error);
        const category = categorizeError(error);
        const setKey = vscode.l10n.t('Set API Key');
        const openSettings = vscode.l10n.t('Open Settings');
        const showLog = vscode.l10n.t('Show Log');
        // The action most likely to fix it first: a key for auth errors, the
        // endpoint, model or timeout for connection and request errors.
        const fix = category === 'auth' ? setKey
            : category === 'network' || category === 'timeout' || category === 'http' ? openSettings
            : undefined;
        const picked = await vscode.window.showErrorMessage(
            vscode.l10n.t('Commit Sage: {0}', error.message),
            ...(fix ? [fix, showLog] : [showLog]),
        );
        if (picked === setKey) {
            void vscode.commands.executeCommand(providerMeta(ConfigService.getProvider()).setCmd);
        } else if (picked === openSettings) {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'commitSage');
        } else if (picked === showLog) {
            Logger.show();
        }
    }

    private static async handleAutoCommit(
        message: string,
        repoPath: string,
        stageAll: boolean,
        signOff: boolean,
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

        await GitService.commitChanges(message, repoPath, stageAll, signOff);

        if (ConfigService.get('commit.autoPush')) {
            await GitService.pushChanges(repoPath);
        }
    }
}
