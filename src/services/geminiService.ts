import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage, IAIService } from '../models/types';
import { ConfigurationError } from '../models/errors';
import { BaseAIService } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
}

// AI сервис для работы с Google Gemini API  
// Реализует интерфейс IAIService со статическими методами
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

            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024
                }
            };

            // Используем retry utils для прогресса
            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const requestConfig = HttpUtils.createRequestConfig(
                { 'content-type': 'application/json' }
            );

            const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);
            progress.report({ message: "Processing generated message...", increment: 90 });

            const message = this.extractCommitMessage(response.data);
            void Logger.log(`Commit message generated using ${model} model`);
            return { message, model };
        } catch (error) {
            // Обработка специальных случаев для Gemini
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 401 && attempt === 1) {
                await ConfigService.removeApiKey();
                await ConfigService.promptForApiKey();
                return this.generateCommitMessage(prompt, progress, attempt + 1);
            }

            if (error instanceof ConfigurationError && attempt === 1) {
                await ConfigService.promptForApiKey();
                return this.generateCommitMessage(prompt, progress, attempt + 1);
            }

            // Используем retry utils для retry логики
            return RetryUtils.handleGenerationError(
                error as Error,
                prompt,
                progress,
                attempt,
                this.generateCommitMessage.bind(this),
                BaseAIService.handleGeminiError.bind(BaseAIService)
            );
        }
    }

    private static extractCommitMessage(response: GeminiResponse): string {
        const content = response.candidates?.[0]?.content?.parts?.[0]?.text;
        return BaseAIService.extractAndValidateMessage(content, 'Gemini');
    }


}
