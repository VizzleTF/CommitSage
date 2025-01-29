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
        const truncatedDiff = this.truncateDiff(diff);
        const prompt = PromptService.generatePrompt(truncatedDiff, blameAnalysis);

        progress.report({ message: "Generating commit message...", increment: 50 });

        try {
            const provider = ConfigService.getProvider();
            if (provider === 'custom') {
                return await CustomEndpointService.generateCommitMessage(prompt, progress);
            } else if (provider === 'codestral') {
                return await this.generateWithCodestral(prompt, progress);
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
            void Logger.log(`Retrying in ${delayMs / 1000} seconds...`);
            progress.report({ message: `Waiting ${delayMs / 1000} seconds before retry...`, increment: 0 });
            await this.delay(delayMs);

            if (provider === 'codestral') {
                return this.generateWithCodestral(prompt, progress, attempt + 1);
            }
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

            if (sourceControlRepository?.rootUri) {
                this.selectedRepository = sourceControlRepository;
                void Logger.log(`Using repository from Source Control view: ${sourceControlRepository.rootUri.fsPath}`);
            }

            await this.executeWithProgress(async progress => {
                const result = await this.generateAndApplyMessage(progress, sourceControlRepository);
                model = result.model;
            });
            void vscode.window.showInformationMessage(`Message generated using ${model}`);

            if (this.selectedRepository?.rootUri && ConfigService.getAutoCommitEnabled()) {
                await this.handleAutoCommit(this.selectedRepository.rootUri.fsPath);
            }
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
                progress.report({ increment: 100 });
            }
        });
    }

    private static async generateAndApplyMessage(
        progress: ProgressReporter,
        sourceControlRepository?: vscode.SourceControl
    ): Promise<CommitMessage> {
        progress.report({ message: "Fetching Git changes...", increment: 0 });

        if (!this.selectedRepository) {
            this.selectedRepository = await GitService.getActiveRepository(sourceControlRepository);
        }

        if (!this.selectedRepository?.rootUri) {
            throw new Error('No active repository found');
        }

        const repoPath = this.selectedRepository.rootUri.fsPath;
        void Logger.log(`Selected repository: ${repoPath}`);

        const onlyStagedChanges = ConfigService.getOnlyStagedChanges();
        void Logger.log(`Only staged changes mode: ${onlyStagedChanges}`);

        const diff = await GitService.getDiff(repoPath, onlyStagedChanges);
        void Logger.log(`Git diff fetched successfully. Length: ${diff.length} characters`);

        const changedFiles = await GitService.getChangedFiles(repoPath, onlyStagedChanges);
        void Logger.log(`Analyzing ${changedFiles.length} changed files`);

        const blameAnalyses: string[] = [];
        for (const filePath of changedFiles.map(file => vscode.Uri.file(path.join(repoPath, file)))) {
            const fileBlameAnalysis = await GitBlameAnalyzer.analyzeChanges(repoPath, filePath.fsPath);
            if (fileBlameAnalysis) {
                blameAnalyses.push(fileBlameAnalysis);
            }
        }

        const message = await AIService.generateCommitMessage(diff, blameAnalyses.join('\n\n'), progress);

        this.selectedRepository.inputBox.value = message.message;
        void Logger.log('Commit message set in input box');

        return message;
    }

    private static async handleError(error: Error): Promise<void> {
        void Logger.error('Error generating commit message:', error);
        void TelemetryService.sendEvent('message_generation_failed', {
            error: error.message
        });
        void vscode.window.showErrorMessage(`Error: ${error.message}`);
    }

    private static async handleAutoCommit(repoPath: string): Promise<void> {
        let commitSuccessful = false;
        try {
            if (!this.selectedRepository?.inputBox.value) {
                throw new Error('No commit message available');
            }

            void Logger.log('Auto commit enabled, committing changes');
            await GitService.commitChanges(this.selectedRepository.inputBox.value, this.selectedRepository);
            void vscode.window.showInformationMessage('Changes committed successfully');
            commitSuccessful = true;

            if (ConfigService.getAutoPushEnabled()) {
                void Logger.log('Auto push enabled, pushing changes');
                try {
                    await GitService.pushChanges(this.selectedRepository);
                    void Logger.log('Changes pushed successfully');
                    void vscode.window.showInformationMessage('Changes pushed successfully');
                } catch (pushError) {
                    const errorMessage = (pushError as Error).message;
                    if (errorMessage.includes('no configured remotes') || errorMessage.includes('Repository has no configured remotes')) {
                        void Logger.log('Repository has no remotes configured, skipping push');
                        void vscode.window.showWarningMessage('Auto-push skipped: Repository has no configured remotes. Add a remote repository to enable pushing.');
                        return;
                    }
                    throw pushError;
                }
            }
        } catch (error) {
            void Logger.error('Error in auto-commit/push:', error as Error);
            if (!commitSuccessful) {
                void vscode.window.showErrorMessage(`Auto-commit failed: ${(error as Error).message}`);
            } else {
                void vscode.window.showErrorMessage(`Auto-push failed: ${(error as Error).message}`);
            }
            if (!commitSuccessful) {
                throw error;
            }
        }
    }
}
