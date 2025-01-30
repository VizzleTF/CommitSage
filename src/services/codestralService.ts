import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { ConfigService } from '../utils/configService';

interface CodestralResponse {
    choices: Array<{
        message: {
            content: string;
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

export class CodestralService {
    private static readonly API_URL = 'https://codestral.mistral.ai/v1/chat/completions';
    private static readonly MAX_RETRY_BACKOFF = 10000;

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        const apiKey = await ConfigService.getCodestralApiKey();
        const model = ConfigService.getCodestralModel();

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

            const response = await axios.post<CodestralResponse>(this.API_URL, payload, requestConfig);

            void Logger.log('Codestral API response received successfully');
            progress.report({ message: "Processing generated message...", increment: 100 });

            const commitMessage = this.extractCommitMessage(response.data);
            void Logger.log(`Commit message generated using ${model} model`);
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

    private static extractCommitMessage(response: CodestralResponse): string {
        if (response.choices?.[0]?.message?.content) {
            const commitMessage = this.cleanCommitMessage(response.choices[0].message.content);
            if (!commitMessage.trim()) {
                throw new Error("Generated commit message is empty.");
            }
            return commitMessage;
        }
        throw new Error("Invalid response format from Codestral API");
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

            return this.generateCommitMessage(prompt, progress, attempt + 1);
        }

        throw new Error(`Failed to generate commit message: ${errorMessage}`);
    }

    private static handleApiError(error: ErrorWithResponse): { errorMessage: string; shouldRetry: boolean } {
        if (error.response) {
            const { status } = error.response;
            const responseData = JSON.stringify(error.response.data);

            switch (status) {
                case 401:
                    return {
                        errorMessage: 'Invalid API key. Please check your Codestral API key.',
                        shouldRetry: false
                    };
                case 429:
                    return {
                        errorMessage: 'Rate limit exceeded. Please try again later.',
                        shouldRetry: true
                    };
                case 500:
                    return {
                        errorMessage: 'Server error. Please try again later.',
                        shouldRetry: true
                    };
                default:
                    return {
                        errorMessage: `API returned status ${status}. ${responseData}`,
                        shouldRetry: status >= 500
                    };
            }
        }

        if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
            return {
                errorMessage: 'Could not connect to Codestral API. Please check your internet connection.',
                shouldRetry: true
            };
        }

        return {
            errorMessage: error.message,
            shouldRetry: false
        };
    }

    private static cleanCommitMessage(message: string): string {
        return message.trim();
    }

    private static calculateRetryDelay(attempt: number): number {
        return Math.min(1000 * Math.pow(2, attempt - 1), this.MAX_RETRY_BACKOFF);
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
} 