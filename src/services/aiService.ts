import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';
import * as path from 'path';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { CustomEndpointService } from './customEndpointService';
import { PromptService } from './promptService';
import { GitService } from './gitService';
import { GitBlameAnalyzer } from './gitBlameAnalyzer';
import { SettingsValidator } from './settingsValidator';
import { TelemetryService } from '../services/telemetryService';
import { errorMessages } from '../utils/constants';

const MAX_DIFF_LENGTH = 100000;
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRY_BACKOFF = 10000; // Maximum retry delay in milliseconds

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
}

interface ApiErrorResponse {
    status: number;
    data: unknown;
}

type ErrorWithResponse = AxiosError & {
    response?: ApiErrorResponse;
};

interface GenerationConfig {
    temperature: number;
    topK: number;
    topP: number;
    maxOutputTokens: number;
}

const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 1024,
};

export class AIService {
    static async generateCommitMessage(
        diff: string,
        blameAnalysis: string,
        progress: ProgressReporter
    ): Promise<CommitMessage> {
        const truncatedDiff = this.truncateDiff(diff);
        const prompt = PromptService.generatePrompt(truncatedDiff, blameAnalysis);

        progress.report({ message: "Generating commit message...", increment: 50 });

        try {
            if (ConfigService.useCustomEndpoint()) {
                return await CustomEndpointService.generateCommitMessage(prompt, progress);
            } else {
                return await this.generateWithGemini(prompt, progress);
            }
        } catch (error) {
            void Logger.error('Failed to generate commit message:', error as Error);
            throw new Error(`Failed to generate commit message: ${(error as Error).message}`);
        }
    }

    private static truncateDiff(diff: string): string {
        if (diff.length > MAX_DIFF_LENGTH) {
            void Logger.log(`Original diff length: ${diff.length}. Truncating to ${MAX_DIFF_LENGTH} characters.`);
            return `${diff.substring(0, MAX_DIFF_LENGTH)}\n...(truncated)`;
        }
        void Logger.log(`Diff length: ${diff.length} characters`);
        return diff;
    }

    private static async generateWithGemini(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        const apiKey = await ConfigService.getApiKey();
        const model = ConfigService.getGeminiModel();
        const apiUrl = `${GEMINI_API_BASE_URL}/${model}:generateContent`;

        const requestConfig = {
            headers: {
                'content-type': 'application/json',
                'x-goog-api-key': apiKey
            },
            timeout: 30000 // 30 seconds timeout
        };

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: DEFAULT_GENERATION_CONFIG,
        };

        try {
            void Logger.log(`Attempt ${attempt}: Sending request to Gemini API`);
            await this.updateProgressForAttempt(progress, attempt);

            const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);

            void Logger.log('Gemini API response received successfully');
            progress.report({ message: "Processing generated message...", increment: 100 });

            const commitMessage = this.extractCommitMessage(response.data);
            void Logger.log(`Commit message generated using ${model} model`);
            void TelemetryService.sendEvent('message_generation_completed');

            return { message: commitMessage, model };
        } catch (error) {
            return await this.handleGenerationError(error as ErrorWithResponse, prompt, progress, attempt);
        }
    }

    private static async updateProgressForAttempt(progress: ProgressReporter, attempt: number): Promise<void> {
        const progressMessage = attempt === 1
            ? "Generating commit message..."
            : `Retry attempt ${attempt}/${ConfigService.getMaxRetries()}...`;
        progress.report({ message: progressMessage, increment: 10 });
    }

    private static extractCommitMessage(response: GeminiResponse): string {
        if (!response.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error("Invalid response format from Gemini API");
        }

        const commitMessage = this.cleanCommitMessage(response.candidates[0].content.parts[0].text);
        if (!commitMessage.trim()) {
            throw new Error("Generated commit message is empty.");
        }

        return commitMessage;
    }

    private static async handleGenerationError(
        error: ErrorWithResponse,
        prompt: string,
        progress: ProgressReporter,
        attempt: number
    ): Promise<CommitMessage> {
        void Logger.error(`Generation attempt ${attempt} failed:`, error);
        const { errorMessage, shouldRetry } = this.handleApiError(error);

        if (shouldRetry && attempt < ConfigService.getMaxRetries()) {
            const delayMs = this.calculateRetryDelay(attempt);
            void Logger.log(`Retrying in ${delayMs / 1000} seconds...`);
            progress.report({ message: `Waiting ${delayMs / 1000} seconds before retry...`, increment: 0 });
            await this.delay(delayMs);
            return this.generateWithGemini(prompt, progress, attempt + 1);
        }

        throw new Error(`Failed to generate commit message: ${errorMessage}`);
    }

    private static handleApiError(error: ErrorWithResponse): { errorMessage: string; shouldRetry: boolean } {
        if (error.response) {
            const { status } = error.response;
            const responseData = JSON.stringify(error.response.data);

            switch (status) {
                case 403:
                    return {
                        errorMessage: errorMessages.apiError.replace('{0}', 'Access forbidden. Please check your API key.'),
                        shouldRetry: false
                    };
                case 429:
                    return {
                        errorMessage: errorMessages.apiError.replace('{0}', 'Rate limit exceeded. Please try again later.'),
                        shouldRetry: true
                    };
                case 500:
                    return {
                        errorMessage: errorMessages.apiError.replace('{0}', 'Server error. Please try again later.'),
                        shouldRetry: true
                    };
                default:
                    return {
                        errorMessage: errorMessages.apiError.replace('{0}', `API returned status ${status}. ${responseData}`),
                        shouldRetry: status >= 500
                    };
            }
        }

        if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
            return {
                errorMessage: errorMessages.networkError.replace('{0}', 'Connection failed. Please check your internet connection.'),
                shouldRetry: true
            };
        }

        return {
            errorMessage: errorMessages.networkError.replace('{0}', error.message),
            shouldRetry: false
        };
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
        let model = 'unknown';
        try {
            await this.initializeAndValidate();
            await this.executeWithProgress(async progress => {
                const result = await this.generateAndApplyMessage(progress, sourceControlRepository);
                model = result.model;
            });
            void vscode.window.showInformationMessage(`Message generated using ${model}`);
        } catch (error) {
            await this.handleError(error as Error);
        } finally {
            this.selectedRepository = undefined;
        }
    }

    private static async initializeAndValidate(): Promise<void> {
        await SettingsValidator.validateAllSettings();
        void Logger.log('Starting commit message generation process');
        void TelemetryService.sendEvent('generate_message_started');
    }

    private static async executeWithProgress(
        action: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>
    ): Promise<void> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating Commit Message",
            cancellable: false
        }, async (progress) => {
            try {
                await action(progress);
                progress.report({ increment: 100 });
            } finally {
                // Ensure progress is completed
                progress.report({ increment: 100 });
            }
        });
    }

    private static async generateAndApplyMessage(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        sourceControlRepository?: vscode.SourceControl
    ): Promise<{ model: string }> {
        try {
            progress.report({ message: "Fetching Git changes...", increment: 0 });

            if (!this.selectedRepository) {
                this.selectedRepository = await GitService.getActiveRepository(sourceControlRepository);
            }

            if (!this.selectedRepository?.rootUri) {
                throw new Error('No active repository found');
            }

            const repoPath = this.selectedRepository.rootUri.fsPath;
            const onlyStagedChanges = ConfigService.getOnlyStagedChanges();
            void Logger.log(`Selected repository: ${repoPath}`);
            void Logger.log(`Only staged changes mode: ${onlyStagedChanges}`);

            const diff = await GitService.getDiff(repoPath, onlyStagedChanges);
            void Logger.log(`Git diff fetched successfully. Length: ${diff.length} characters`);

            progress.report({ message: "Analyzing code changes...", increment: 25 });
            const changedFiles = await GitService.getChangedFiles(repoPath, onlyStagedChanges);
            void Logger.log(`Analyzing ${changedFiles.length} changed files`);

            const blameAnalysis = await this.analyzeChanges(repoPath, changedFiles);
            void Logger.log(`Diff length: ${diff.length} characters`);

            const { message, model } = await AIService.generateCommitMessage(diff, blameAnalysis, progress);

            progress.report({ message: "Setting commit message...", increment: 90 });
            await this.setCommitMessage(message);

            void Logger.log(`Commit message generated using ${model} model`);
            void TelemetryService.sendEvent('message_generation_completed');

            return { model };
        } catch (error) {
            void Logger.error('Error in generateAndApplyMessage:', error as Error);
            throw error;
        }
    }

    private static async handleError(error: Error): Promise<void> {
        void Logger.error('Error generating commit message:', error);
        void TelemetryService.sendEvent('message_generation_failed', {
            error: error.message
        });
        void vscode.window.showErrorMessage(`Error: ${error.message}`);
    }

    private static async analyzeChanges(repoPath: string, changedFiles: string[]): Promise<string> {
        let blameAnalysis = '';
        for (const file of changedFiles) {
            const filePath = vscode.Uri.file(path.join(repoPath, file));
            try {
                const fileBlameAnalysis = await GitBlameAnalyzer.analyzeChanges(repoPath, filePath.fsPath);
                blameAnalysis += `File: ${file}\n${fileBlameAnalysis}\n\n`;
                void Logger.log(`Blame analysis completed for: ${file}`);
            } catch (error) {
                void Logger.error(`Error analyzing file ${file}:`, error as Error);
                blameAnalysis += `File: ${file}\nUnable to analyze: ${(error as Error).message}\n\n`;
            }
        }
        return blameAnalysis;
    }

    private static async setCommitMessage(message: string): Promise<void> {
        if (!this.selectedRepository?.rootUri) {
            throw new Error('No active repository found');
        }
        this.selectedRepository.inputBox.value = message;
        void Logger.log('Commit message set in input box');

        if (ConfigService.getAutoCommitEnabled()) {
            await this.handleAutoCommit(this.selectedRepository.rootUri.fsPath, message);
        }
    }

    private static async handleAutoCommit(repoPath: string, message: string): Promise<void> {
        void Logger.log('Auto commit enabled, committing changes');
        await GitService.commitChanges(message);

        if (ConfigService.getAutoPushEnabled()) {
            void Logger.log('Auto push enabled, pushing changes');
            await GitService.pushChanges();
            void Logger.log('Changes pushed successfully');
        }
    }
}
