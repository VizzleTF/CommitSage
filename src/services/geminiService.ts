import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage } from '../models/types';
import { errorMessages } from '../utils/constants';
import { ConfigurationError } from '../models/errors';

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
}

export class GeminiService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        try {
            const apiKey = await ConfigService.getApiKey();
            const model = ConfigService.getGeminiModel();
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

            const requestConfig = {
                headers: {
                    'content-type': 'application/json'
                },
                timeout: 30000
            };

            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024
                }
            };

            progress.report({ message: "Generating commit message...", increment: 50 });

            const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);
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
                            // Если это первая попытка и ключ неверный, запросим новый ключ и попробуем снова
                            await ConfigService.removeApiKey();
                            await ConfigService.promptForApiKey();
                            return this.generateCommitMessage(prompt, progress, attempt + 1);
                        }
                        throw new Error(errorMessages.authenticationError);
                    case 402:
                        throw new Error(errorMessages.paymentRequired);
                    case 429:
                        throw new Error(errorMessages.rateLimitExceeded);
                    case 422:
                        throw new Error(
                            data.error?.message || errorMessages.invalidRequest
                        );
                    case 500:
                        throw new Error(errorMessages.serverError);
                    default:
                        throw new Error(
                            `${errorMessages.apiError.replace('{0}', String(status))}: ${data.error?.message || 'Unknown error'}`
                        );
                }
            }

            if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ETIMEDOUT') {
                throw new Error(
                    errorMessages.networkError.replace('{0}', 'Connection failed. Please check your internet connection.')
                );
            }

            // Если ключ не установлен и это первая попытка
            if (error instanceof ConfigurationError && attempt === 1) {
                await ConfigService.promptForApiKey();
                return this.generateCommitMessage(prompt, progress, attempt + 1);
            }

            throw new Error(
                errorMessages.networkError.replace('{0}', axiosError.message)
            );
        }
    }

    private static extractCommitMessage(response: GeminiResponse): string {
        if (!response.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Unexpected response format from Gemini API');
        }

        return response.candidates[0].content.parts[0].text.trim();
    }
}
