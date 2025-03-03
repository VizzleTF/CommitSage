import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage } from '../models/types';
import { errorMessages } from '../utils/constants';
import { OpenAIError, ConfigurationError } from '../models/errors';

interface OpenAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

interface ModelsResponse {
    data: Array<{
        id: string;
        ownedBy?: string;
    }>;
}

type ApiHeaders = Record<string, string>;

export class OpenAIService {
    private static readonly chatCompletionsPath = '/chat/completions';
    private static readonly modelsPath = '/models';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        try {
            const apiKey = await ConfigService.getOpenAIApiKey();
            const model = ConfigService.getOpenAIModel();
            const baseUrl = ConfigService.getOpenAIBaseUrl();

            const payload = {
                model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7,
                maxTokens: 1024
            };

            const headers = {
                'Authorization': `Bearer ${apiKey}`,
                'content-type': 'application/json'
            };

            progress.report({ message: "Generating commit message...", increment: 50 });

            const response = await axios.post<OpenAIResponse>(
                `${baseUrl}/chat/completions`,
                payload,
                { headers }
            );

            progress.report({ message: "Processing generated message...", increment: 90 });

            const message = this.extractCommitMessage(response.data);
            void Logger.log(`Commit message generated using ${model} model`);
            return { message, model };
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                const status = axiosError.response.status;
                const data = axiosError.response.data as { error?: { message?: string } };

                switch (status) {
                    case 401:
                        if (attempt === 1) {
                            await ConfigService.removeOpenAIApiKey();
                            await ConfigService.promptForOpenAIApiKey();
                            return this.generateCommitMessage(prompt, progress, attempt + 1);
                        }
                        throw new OpenAIError(errorMessages.authenticationError);
                    case 402:
                        throw new OpenAIError(errorMessages.paymentRequired);
                    case 429:
                        throw new OpenAIError(errorMessages.rateLimitExceeded);
                    case 422:
                        throw new OpenAIError(
                            data.error?.message || errorMessages.invalidRequest
                        );
                    case 500:
                        throw new OpenAIError(errorMessages.serverError);
                    default:
                        throw new OpenAIError(
                            `${errorMessages.apiError.replace('{0}', String(status))}: ${data.error?.message || 'Unknown error'}`
                        );
                }
            }

            if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ETIMEDOUT') {
                throw new OpenAIError(
                    errorMessages.networkError.replace('{0}', 'Connection failed. Please check your internet connection.')
                );
            }

            // Если ключ не установлен и это первая попытка
            if (error instanceof ConfigurationError && attempt === 1) {
                await ConfigService.promptForOpenAIApiKey();
                return this.generateCommitMessage(prompt, progress, attempt + 1);
            }

            throw new OpenAIError(
                errorMessages.networkError.replace('{0}', axiosError.message)
            );
        }
    }

    static async fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
        try {
            const headers: ApiHeaders = {
                'content-type': 'application/json',
                'authorization': `Bearer ${apiKey}`
            };

            const response = await axios.get<ModelsResponse>(
                `${baseUrl}${this.modelsPath}`,
                { headers }
            );

            if (!response.data?.data) {
                return [];
            }

            const models = response.data.data.map(model => model.id);
            if (models.length > 0) {
                void Logger.log(`Successfully fetched ${models.length} models`);
            }
            return models;
        } catch {
            return [];
        }
    }

    private static extractCommitMessage(response: OpenAIResponse): string {
        if (!response.choices?.[0]?.message?.content) {
            throw new OpenAIError('Unexpected response format from OpenAI API');
        }

        let content = response.choices[0].message.content.trim();

        // Remove <think> tags for DeepSeek R1 model support
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        return content;
    }
}
