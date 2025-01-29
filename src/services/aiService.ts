import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';
import * as path from 'path';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { OpenAIService } from './openaiService';
import { PromptService } from './promptService';
import { GitService } from './gitService';
import { GitBlameAnalyzer } from './gitBlameAnalyzer';
import { SettingsValidator } from './settingsValidator';
import { TelemetryService } from './telemetryService';
import { errorMessages } from '../utils/constants';
import { GeminiService } from './geminiService';
import { CodestralService } from './codestralService';
import { OllamaService } from './ollamaService';

const MAX_DIFF_LENGTH = 100000;
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRY_BACKOFF = 10000;

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
        if (!diff) {
            throw new Error(errorMessages.noChanges);
        }

        const truncatedDiff = this.truncateDiff(diff);
        const prompt = PromptService.generatePrompt(truncatedDiff, blameAnalysis);

        progress.report({ message: "Generating commit message...", increment: 50 });

        try {
            const provider = ConfigService.getProvider();
            switch (provider) {
                case 'openai':
                    return await OpenAIService.generateCommitMessage(prompt, progress);
                case 'codestral':
                    return await CodestralService.generateCommitMessage(prompt, progress);
                case 'ollama':
                    return await OllamaService.generateCommitMessage(prompt, progress);
                case 'gemini':
                default:
                    return await GeminiService.generateCommitMessage(prompt, progress);
            }
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

    private static async generateWithGemini(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        const apiKey = await ConfigService.getApiKey();
        const model = ConfigService.getGeminiModel();
        const apiUrl = `${GEMINI_API_BASE_URL}/${model}:generateContent?key=${apiKey}`;

        const requestConfig = {
            headers: {
                'content-type': 'application/json'
            },
            timeout: 30000
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

            const commitMessage = this.extractCommitMessage(response.data, 'gemini');
            void Logger.log(`Commit message generated using ${model} model`);
            void TelemetryService.sendEvent('message_generation_completed');

            return { message: commitMessage, model };
        } catch (error) {
            return await this.handleGenerationError(error as ErrorWithResponse, prompt, progress, attempt, 'gemini');
        }
    }

    private static async generateWithCodestral(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        const apiKey = await ConfigService.getCodestralApiKey();
        const model = ConfigService.getCodestralModel();
        const apiUrl = 'https://codestral.mistral.ai/v1/chat/completions';

        const requestConfig = {
            headers: {
                'content-type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: 30000
        };

        const payload = {
            model: model,
            messages: [{ role: "user", content: prompt }]
        };

        try {
            void Logger.log(`Attempt ${attempt}: Sending request to Codestral API`);
            await this.updateProgressForAttempt(progress, attempt);

            const response = await axios.post<any>(apiUrl, payload, requestConfig);

            void Logger.log('Codestral API response received successfully');
            progress.report({ message: "Processing generated message...", increment: 100 });

            const commitMessage = this.extractCommitMessage(response.data, 'codestral');
            void Logger.log(`Commit message generated using ${model} model`);
            void TelemetryService.sendEvent('message_generation_completed');

            return { message: commitMessage, model };
        } catch (error) {
            return await this.handleGenerationError(error as ErrorWithResponse, prompt, progress, attempt, 'codestral');
        }
    }

    private static async updateProgressForAttempt(progress: ProgressReporter, attempt: number): Promise<void> {
        const progressMessage = attempt === 1
            ? "Generating commit message..."
            : `Retry attempt ${attempt}/${ConfigService.getMaxRetries()}...`;
        progress.report({ message: progressMessage, increment: 10 });
    }

    private static extractCommitMessage(response: any, provider: string): string {
        if (provider === 'gemini') {
            if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
                const commitMessage = this.cleanCommitMessage(response.candidates[0].content.parts[0].text);
                if (!commitMessage.trim()) {
                    throw new Error("Generated commit message is empty.");
                }
                return commitMessage;
            }
        } else if (provider === 'codestral') {
            if (response.choices?.[0]?.message?.content) {
                const commitMessage = this.cleanCommitMessage(response.choices[0].message.content);
                if (!commitMessage.trim()) {
                    throw new Error("Generated commit message is empty.");
                }
                return commitMessage;
            }
        }
        throw new Error("Invalid response format from API");
    }

    private static async handleGenerationError(
        error: ErrorWithResponse,
        prompt: string,
        progress: ProgressReporter,
        attempt: number,
        provider: string
    ): Promise<CommitMessage> {
        void Logger.error(`Generation attempt ${attempt} failed:`, error);
        const { errorMessage, shouldRetry } = this.handleApiError(error);

        if (shouldRetry && attempt < ConfigService.getMaxRetries()) {
            const delayMs = this.calculateRetryDelay(attempt);
            progress.report({ message: `Waiting ${delayMs / 1000} seconds before retry...`, increment: 0 });
            await this.delay(delayMs);

            if (provider === 'codestral') {
                return this.generateWithCodestral(prompt, progress, attempt + 1);
            }
            return this.generateWithGemini(prompt, progress, attempt + 1);
        }

        throw new Error(errorMessage);
    }

    private static handleApiError(error: ErrorWithResponse): { errorMessage: string; shouldRetry: boolean } {
        if (error.response) {
            const { status } = error.response;
            const responseData = JSON.stringify(error.response.data);

            switch (status) {
                case 402:
                    return {
                        errorMessage: errorMessages.apiError.replace('{0}', 'Payment required. Please check your subscription or billing status.'),
                        shouldRetry: false
                    };
                case 403:
                    return {
                        errorMessage: errorMessages.apiError.replace('{0}', 'Access forbidden. Please check your API key.'),
                        shouldRetry: false
                    };
                case 422:
                    return {
                        errorMessage: errorMessages.apiError.replace('{0}', 'Invalid request. The input may be too long or contain invalid characters.'),
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
        try {
            await this.initializeAndValidate();
            await this.executeWithProgress(async progress => {
                const commitMessage = await this.generateAndApplyMessage(progress, sourceControlRepository);
                void Logger.log(`Commit message generated: ${commitMessage.message}`);
                void TelemetryService.sendEvent('message_generation_completed');
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

        // Determine whether to use staged changes
        const useStagedChanges = onlyStagedSetting || hasStagedChanges;

        // Get diff based on the determined mode
        const diff = await GitService.getDiff(repoPath, useStagedChanges);
        if (!diff) {
            throw new Error('No changes to commit');
        }

        // Get changed files with the same logic
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
