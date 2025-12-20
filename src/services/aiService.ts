import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { PromptService } from './promptService';
import { GitService } from './gitService';
import { GitBlameAnalyzer } from './gitBlameAnalyzer';
import { TelemetryService } from './telemetryService';
import { errorMessages } from '../utils/constants';
import { removeThinkTags } from '../utils/textProcessing';
import { AIServiceFactory, AIServiceType } from './aiServiceFactory';
import { UserCancelledError, ApiKeyInvalidError } from '../models/errors';

const MAX_DIFF_LENGTH = 100000;

export class AIService {
    static requiresApiKey(provider: string): boolean {
        return ['gemini', 'openai', 'codestral'].includes(provider.toLowerCase());
    }

    static async generateCommitMessage(
        diff: string,
        blameAnalysis: string,
        progress: ProgressReporter
    ): Promise<CommitMessage> {
        if (!diff) {
            throw new Error(errorMessages.noChanges);
        }

        const truncatedDiff = this.truncateDiff(diff);
        const prompt = PromptService.generatePrompt(truncatedDiff, blameAnalysis);

        progress.report({ message: "Generating commit message...", increment: 50 });

        try {
            const provider = ConfigService.getProvider();

            // Преобразуем string provider в AIServiceType enum
            const serviceType = this.getServiceTypeFromProvider(provider);

            // Используем фабрику для генерации
            const result = await AIServiceFactory.generateCommitMessage(serviceType, prompt, progress);

            // Post-process the commit message to remove think tags
            result.message = removeThinkTags(result.message);
            void TelemetryService.sendEvent('message_generation_completed', { provider, model: result.model });
            return result;
        } catch (error) {
            void Logger.error('Failed to generate commit message:', error as Error);
            void TelemetryService.sendEvent('message_generation_failed', {
                provider: ConfigService.getProvider(),
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    private static truncateDiff(diff: string): string {
        return diff.length > MAX_DIFF_LENGTH
            ? `${diff.substring(0, MAX_DIFF_LENGTH)}\n...(truncated)`
            : diff;
    }

    /**
     * Преобразует строковый provider в enum AIServiceType
     */
    private static getServiceTypeFromProvider(provider: string): AIServiceType {
        switch (provider) {
            case 'openai':
                return AIServiceType.OPENAI;
            case 'codestral':
                return AIServiceType.CODESTRAL;
            case 'ollama':
                return AIServiceType.OLLAMA;
            case 'gemini':
            default:
                return AIServiceType.GEMINI;
        }
    }
}

export class CommitMessageUI {
    private static selectedRepository: vscode.SourceControl | undefined;

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
            if (AIService.requiresApiKey(provider)) {
                await this.ensureApiKey(provider);
            }

            await this.executeWithProgress(async (progress, token) => {
                // Check for cancellation
                if (token.isCancellationRequested) {
                    throw new UserCancelledError();
                }

                const commitMessage = await this.generateAndApplyMessage(progress, sourceControlRepository!, token);
                void Logger.log(`Commit message generated: ${commitMessage.message}`);
            });
        } catch (error: unknown) {
            // Don't show error for user cancellation
            if (error instanceof UserCancelledError) {
                void Logger.log('Operation cancelled by user');
                return;
            }

            // Handle invalid API key error - prompt for new key and retry
            if (error instanceof ApiKeyInvalidError) {
                void Logger.error('Invalid API key', error);
                const provider = ConfigService.getProvider();
                await this.handleInvalidApiKey(provider);
                return;
            }

            void Logger.error('Error in CommitMessageUI:', error instanceof Error ? error : new Error(String(error)));
            void TelemetryService.sendEvent('message_generation_failed', {
                error: error instanceof Error ? error.message : String(error),
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
                provider: ConfigService.getProvider()
            });
            await this.handleError(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private static async ensureApiKey(provider: string): Promise<void> {
        try {
            switch (provider) {
                case 'gemini':
                    await ConfigService.getApiKey();
                    break;
                case 'openai':
                    await ConfigService.getOpenAIApiKey();
                    break;
                case 'codestral':
                    await ConfigService.getCodestralApiKey();
                    break;
            }
        } catch (error) {
            // If user cancelled the API key input, throw UserCancelledError
            if (error instanceof Error && error.message.includes('cancelled')) {
                throw new UserCancelledError('API key input was cancelled');
            }
            throw error;
        }
    }

    private static async handleInvalidApiKey(provider: string): Promise<void> {
        const selection = await Logger.showError(
            'Invalid or expired API key. Please enter a new one.',
        );

        // Prompt for new API key
        try {
            switch (provider) {
                case 'gemini':
                    await ConfigService.removeApiKey();
                    await ConfigService.promptForApiKey();
                    break;
                case 'openai':
                    await ConfigService.removeOpenAIApiKey();
                    await ConfigService.promptForOpenAIApiKey();
                    break;
                case 'codestral':
                    await ConfigService.removeCodestralApiKey();
                    await ConfigService.promptForCodestralApiKey();
                    break;
            }

            // Retry generation
            void Logger.log('API key updated, retrying commit message generation');
            await this.generateAndSetCommitMessage();
        } catch (error) {
            if (error instanceof Error && error.message.includes('cancelled')) {
                void Logger.log('User cancelled API key update');
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
        progress: ProgressReporter,
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

        const diff = await GitService.getDiff(repoPath, useStagedChanges);
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

        const commitMessage = await AIService.generateCommitMessage(diff, blameAnalysis, progress);

        sourceControlRepository.inputBox.value = commitMessage.message;
        this.selectedRepository = sourceControlRepository;

        if (ConfigService.getAutoCommitEnabled()) {
            await this.handleAutoCommit();
        }

        return commitMessage;
    }

    private static async handleError(error: Error): Promise<void> {
        void Logger.error('Error in CommitMessageUI:', error);
        await vscode.window.showErrorMessage(`CommitSage: ${error.message}`);
    }

    private static async handleAutoCommit(): Promise<void> {
        try {
            if (!this.selectedRepository?.inputBox.value) {
                throw new Error('No commit message available');
            }

            await GitService.commitChanges(this.selectedRepository.inputBox.value, this.selectedRepository);

            if (ConfigService.getAutoPushEnabled()) {
                await GitService.pushChanges(this.selectedRepository);
            }
        } catch (error) {
            void Logger.error('Auto-commit/push failed:', error as Error);
            throw error;
        }
    }
}
