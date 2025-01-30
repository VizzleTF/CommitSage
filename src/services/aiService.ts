import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { OpenAIService } from './openaiService';
import { PromptService } from './promptService';
import { GitService } from './gitService';
import { GitBlameAnalyzer } from './gitBlameAnalyzer';
import { TelemetryService } from './telemetryService';
import { errorMessages } from '../utils/constants';
import { GeminiService } from './geminiService';
import { CodestralService } from './codestralService';
import { OllamaService } from './ollamaService';

const MAX_DIFF_LENGTH = 100000;
const MAX_RETRY_BACKOFF = 10000;

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
            let result: CommitMessage;
            switch (provider) {
                case 'openai':
                    result = await OpenAIService.generateCommitMessage(prompt, progress);
                    break;
                case 'codestral':
                    result = await CodestralService.generateCommitMessage(prompt, progress);
                    break;
                case 'ollama':
                    result = await OllamaService.generateCommitMessage(prompt, progress);
                    break;
                case 'gemini':
                default:
                    result = await GeminiService.generateCommitMessage(prompt, progress);
                    break;
            }
            void TelemetryService.sendEvent('message_generation_completed', { provider, model: result.model });
            return result;
        } catch (error) {
            void Logger.error('Failed to generate commit message:', error as Error);
            throw error;
        }
    }

    private static truncateDiff(diff: string): string {
        return diff.length > MAX_DIFF_LENGTH
            ? `${diff.substring(0, MAX_DIFF_LENGTH)}\n...(truncated)`
            : diff;
    }

    private static cleanCommitMessage(message: string): string {
        return message
            .replace(/^["']|["']$/g, '')
            .replace(/^(Here'?s? (is )?(a )?)?commit message:?\s*/i, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private static calculateRetryDelay(attempt: number): number {
        const initialDelay = ConfigService.getInitialRetryDelay();
        return Math.min(initialDelay * Math.pow(2, attempt - 1), MAX_RETRY_BACKOFF);
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export class CommitMessageUI {
    private static selectedRepository: vscode.SourceControl | undefined;

    static async generateAndSetCommitMessage(sourceControlRepository?: vscode.SourceControl): Promise<void> {
        try {
            await this.initializeAndValidate();
            await this.executeWithProgress(async progress => {
                const commitMessage = await this.generateAndApplyMessage(progress, sourceControlRepository);
                void Logger.log(`Commit message generated: ${commitMessage.message}`);
            });
        } catch (error) {
            await this.handleError(error as Error);
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
        sourceControlRepository?: vscode.SourceControl
    ): Promise<CommitMessage> {
        progress.report({ message: "Analyzing changes...", increment: 10 });

        const repo = sourceControlRepository || await GitService.getActiveRepository();
        if (!repo?.rootUri) {
            throw new Error('No Git repository found');
        }

        const repoPath = repo.rootUri.fsPath;
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

        repo.inputBox.value = commitMessage.message;
        this.selectedRepository = sourceControlRepository;

        if (ConfigService.getAutoCommitEnabled()) {
            await this.handleAutoCommit(repoPath);
        }

        return commitMessage;
    }

    private static async handleError(error: Error): Promise<void> {
        void Logger.error('Error in CommitMessageUI:', error);
        await vscode.window.showErrorMessage(`CommitSage: ${error.message}`);
    }

    private static async handleAutoCommit(repoPath: string): Promise<void> {
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
