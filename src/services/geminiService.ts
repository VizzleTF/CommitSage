import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage } from '../models/types';
import { ApiKeyInvalidError } from '../models/errors';
import { BaseAIService } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ApiKeyManager } from './apiKeyManager';
import { toError } from '../utils/errorUtils';

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
}

interface GeminiModel {
    name: string;
    baseModelId: string;
    supportedGenerationMethods: string[];
}

interface GeminiModelsResponse {
    models: GeminiModel[];
}

const GEMINI_GENERATION_CONFIG = {
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 1024
} as const;

// AI сервис для работы с Google Gemini API
// Реализует интерфейс IAIService со статическими методами
export class GeminiService {
    /**
     * Получает список доступных моделей Gemini через API
     */
    private static async getAvailableModels(apiKey: string): Promise<string[]> {
        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
            const requestConfig = HttpUtils.createRequestConfig({});
            
            const response = await axios.get<GeminiModelsResponse>(apiUrl, requestConfig);
            
            // Фильтруем только модели, поддерживающие generateContent
            const models = response.data.models
                .filter((model: GeminiModel) => 
                    model.supportedGenerationMethods?.includes('generateContent')
                )
                .map((model: GeminiModel) => model.name.replace('models/', ''));
            
            Logger.log(`Found ${models.length} available Gemini models: ${models.join(', ')}`);
            return models;
        } catch (error) {
            Logger.error('Failed to fetch available Gemini models:', toError(error));
            // В случае ошибки возвращаем дефолтный список моделей
            const fallbackModels = [
                'gemini-2.0-flash',
                'gemini-2.0-flash-exp',
                'gemini-2.5-flash',
                'gemini-2.5-pro'
            ];
            return fallbackModels;
        }
    }

    /**
     * Пробует сгенерировать сообщение коммита, перебирая модели по очереди
     */
    private static async tryGenerateWithModels(
        prompt: string,
        progress: ProgressReporter,
        models: string[],
        apiKey: string
    ): Promise<CommitMessage> {
        const errors: Array<{ model: string; error: string }> = [];
        
        for (let i = 0; i < models.length; i++) {
            const model = models[i];
            const modelProgress = Math.floor(((i + 1) / models.length) * 100);
            
            try {
                progress.report({ 
                    message: `Trying model ${i + 1}/${models.length}: ${model}...`, 
                    increment: 0 
                });
                
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                
                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: GEMINI_GENERATION_CONFIG
                };
                
                const requestConfig = HttpUtils.createRequestConfig(
                    { 'content-type': 'application/json' }
                );
                
                const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);
                
                const message = this.extractCommitMessage(response.data);
                Logger.log(`Commit message successfully generated using ${model} model (auto mode)`);
                
                progress.report({ message: "Processing generated message...", increment: 100 });
                return { message, model };
                
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push({ model, error: errorMsg });
                Logger.log(`Model ${model} failed: ${errorMsg}`);
                
                // Если это последняя модель, пробрасываем ошибку
                if (i === models.length - 1) {
                    const errorSummary = errors.map(e => `${e.model}: ${e.error}`).join('; ');
                    throw new Error(`All models failed. Errors: ${errorSummary}`);
                }
                
                // Иначе продолжаем со следующей моделью
                continue;
            }
        }

        // TypeScript requires a return, but this is unreachable:
        // the loop always either returns or throws on the last iteration
        throw new Error('Failed to generate commit message with any available model');
    }

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        try {
            const apiKey = await ApiKeyManager.getKey('gemini');
            const configuredModel = ConfigService.getGeminiModel();
            
            // Проверяем режим "auto"
            if (configuredModel === 'auto') {
                progress.report({ message: "Fetching available Gemini models...", increment: 0 });
                const availableModels = await this.getAvailableModels(apiKey);
                
                if (availableModels.length === 0) {
                    throw new Error('No available Gemini models found');
                }
                
                return await this.tryGenerateWithModels(prompt, progress, availableModels, apiKey);
            }
            
            // Стандартный режим с одной моделью
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${configuredModel}:generateContent?key=${apiKey}`;

            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: GEMINI_GENERATION_CONFIG
            };

            // Используем retry utils для прогресса
            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const requestConfig = HttpUtils.createRequestConfig(
                { 'content-type': 'application/json' }
            );

            const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);
            progress.report({ message: "Processing generated message...", increment: 90 });

            const message = this.extractCommitMessage(response.data);
            Logger.log(`Commit message generated using ${configuredModel} model`);
            return { message, model: configuredModel };
        } catch (error) {
            // Обработка специальных случаев для Gemini
            if (error instanceof AxiosError && error.response?.status === 401) {
                throw new ApiKeyInvalidError('Gemini');
            }

            // Используем retry utils для retry логики
            return RetryUtils.handleGenerationError(
                toError(error),
                prompt,
                progress,
                attempt,
                this.generateCommitMessage.bind(this),
                (err: Error) => BaseAIService.handleHttpError(err, 'Gemini API')
            );
        }
    }

    private static extractCommitMessage(response: GeminiResponse): string {
        const content = response.candidates?.[0]?.content?.parts?.[0]?.text;
        return BaseAIService.extractAndValidateMessage(content, 'Gemini');
    }


}
