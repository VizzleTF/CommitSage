import axios, { AxiosError } from 'axios';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage } from '../models/types';
import { errorMessages } from '../utils/constants';
import { OpenAIError } from '../models/errors';

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
        owned_by?: string;
    }>;
}

type ApiHeaders = Record<string, string>;

export class OpenAIService {
    private static readonly CHAT_COMPLETIONS_PATH = '/chat/completions';
    private static readonly MODELS_PATH = '/models';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter
    ): Promise<CommitMessage> {
        const apiKey = await ConfigService.getOpenAIApiKey();
        const model = ConfigService.getOpenAIModel();
        const baseUrl = ConfigService.getOpenAIBaseUrl();

        const payload = {
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 1024
        };

        const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        };

        try {
            progress.report({ message: "Generating commit message...", increment: 50 });

            const response = await axios.post<OpenAIResponse>(
                `${baseUrl}/chat/completions`,
                payload,
                { headers }
            );

            progress.report({ message: "Processing generated message...", increment: 100 });

            const message = this.extractCommitMessage(response.data);
            return { message, model };
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                const status = axiosError.response.status;
                const data = axiosError.response.data as any;

                // Handle specific OpenAI error cases
                switch (status) {
                    case 401:
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
                `${baseUrl}${this.MODELS_PATH}`,
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
        } catch (error) {
            return [];
        }
    }

    private static extractCommitMessage(response: OpenAIResponse): string {
        if (!response.choices?.[0]?.message?.content) {
            throw new OpenAIError('Unexpected response format from OpenAI API');
        }

        return response.choices[0].message.content.trim();
    }
} 