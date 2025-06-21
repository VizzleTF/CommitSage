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

const MAX_DIFF_LENGTH = 100000;

export class AIService {
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
            let result = await AIServiceFactory.generateCommitMessage(serviceType, prompt, progress);

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

            await this.executeWithProgress(async progress => {
                const commitMessage = await this.generateAndApplyMessage(progress, sourceControlRepository!);
                void Logger.log(`Commit message generated: ${commitMessage.message}`);
            });
        } catch (error: unknown) {
            void Logger.error('Error in CommitMessageUI:', error instanceof Error ? error : new Error(String(error)));
            void TelemetryService.sendEvent('message_generation_failed', {
                error: error instanceof Error ? error.message : String(error),
                errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
                provider: ConfigService.getProvider()
            });
            await this.handleError(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private static async initializeAndValidate(): Promise<void> {
        if (!vscode.workspace.workspaceFolders) {
            throw new Error('No workspace folder is open');
        }
    }

    private static async executeWithProgress(
        action: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>
    ): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'CommitSage',
                cancellable: false
            },
            action
        );
    }

    private static async generateAndApplyMessage(
        progress: ProgressReporter,
        sourceControlRepository: vscode.SourceControl
    ): Promise<CommitMessage> {
        progress.report({ message: "Analyzing changes...", increment: 10 });

        if (!sourceControlRepository?.rootUri) {
            throw new Error('No Git repository found');
        }

        const repoPath = sourceControlRepository.rootUri.fsPath;
        const onlyStagedSetting = ConfigService.getOnlyStagedChanges();
        const hasStagedChanges = await GitService.hasChanges(repoPath, 'staged');
        const useStagedChanges = onlyStagedSetting || hasStagedChanges;

        const diff = await GitService.getDiff(repoPath, useStagedChanges);
        if (!diff) {
            throw new Error('No changes to commit');
        }

        const changedFiles = await GitService.getChangedFiles(repoPath, useStagedChanges);
        const blameAnalyses = await Promise.all(
            changedFiles.map(file => GitBlameAnalyzer.analyzeChanges(repoPath, file))
        );
        const blameAnalysis = blameAnalyses.filter(analysis => analysis).join('\n\n');

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
