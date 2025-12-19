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

interface GeminiModel {
    name: string;
    baseModelId: string;
    supportedGenerationMethods: string[];
}

interface GeminiModelsResponse {
    models: GeminiModel[];
}

// AI сервис для работы с Google Gemini API  
// Реализует интерфейс IAIService со статическими методами
export class GeminiService {
    /**
     * Получает список доступных моделей Gemini через API
     */
    private static async getAvailableModels(apiKey: string): Promise<string[]> {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:36',message:'getAvailableModels entry',data:{apiKeyLength:apiKey?.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,B,C,E'})}).catch(()=>{});
        // #endregion
        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
            const requestConfig = HttpUtils.createRequestConfig({});
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:41',message:'Before API request',data:{apiUrl:apiUrl.replace(apiKey,'***'),requestConfig},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            
            const response = await axios.get<GeminiModelsResponse>(apiUrl, requestConfig);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:46',message:'API response received',data:{modelsCount:response.data.models?.length,firstModel:response.data.models?.[0]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,B'})}).catch(()=>{});
            // #endregion
            
            // Фильтруем только модели, поддерживающие generateContent
            const models = response.data.models
                .filter((model: GeminiModel) => 
                    model.supportedGenerationMethods?.includes('generateContent')
                )
                .map((model: GeminiModel) => model.name.replace('models/', ''));
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:57',message:'After filtering models',data:{filteredCount:models.length,models:models},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            
            void Logger.log(`Found ${models.length} available Gemini models: ${models.join(', ')}`);
            return models;
        } catch (error) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:65',message:'Catch block - error occurred',data:{errorMessage:error instanceof Error ? error.message : String(error),errorType:error?.constructor?.name},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D,E'})}).catch(()=>{});
            // #endregion
            void Logger.error('Failed to fetch available Gemini models:', error as Error);
            // В случае ошибки возвращаем дефолтный список моделей
            const fallbackModels = [
                'gemini-2.0-flash',
                'gemini-2.0-flash-exp',
                'gemini-2.5-flash',
                'gemini-2.5-pro'
            ];
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:77',message:'Returning fallback models',data:{fallbackModels},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
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
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 1024
                    }
                };
                
                const requestConfig = HttpUtils.createRequestConfig(
                    { 'content-type': 'application/json' }
                );
                
                const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);
                
                const message = this.extractCommitMessage(response.data);
                void Logger.log(`Commit message successfully generated using ${model} model (auto mode)`);
                
                progress.report({ message: "Processing generated message...", increment: 100 });
                return { message, model };
                
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push({ model, error: errorMsg });
                void Logger.log(`Model ${model} failed: ${errorMsg}`);
                
                // Если это последняя модель, пробрасываем ошибку
                if (i === models.length - 1) {
                    const errorSummary = errors.map(e => `${e.model}: ${e.error}`).join('; ');
                    throw new Error(`All models failed. Errors: ${errorSummary}`);
                }
                
                // Иначе продолжаем со следующей моделью
                continue;
            }
        }
        
        // Этот код не должен выполниться, но на всякий случай
        throw new Error('Failed to generate commit message with any available model');
    }

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        try {
            const apiKey = await ConfigService.getApiKey();
            const configuredModel = ConfigService.getGeminiModel();
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:138',message:'generateCommitMessage entry',data:{configuredModel,attempt},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            
            // Проверяем режим "auto"
            if (configuredModel === 'auto') {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:145',message:'Auto mode detected, fetching models',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                progress.report({ message: "Fetching available Gemini models...", increment: 0 });
                const availableModels = await this.getAvailableModels(apiKey);
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:151',message:'Models fetched',data:{availableModelsCount:availableModels.length,availableModels},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C,D'})}).catch(()=>{});
                // #endregion
                
                if (availableModels.length === 0) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/677a5018-8c46-4867-8036-e446f1e21911',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'geminiService.ts:157',message:'ERROR: No models available',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C,D'})}).catch(()=>{});
                    // #endregion
                    throw new Error('No available Gemini models found');
                }
                
                return await this.tryGenerateWithModels(prompt, progress, availableModels, apiKey);
            }
            
            // Стандартный режим с одной моделью
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${configuredModel}:generateContent?key=${apiKey}`;

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
            void Logger.log(`Commit message generated using ${configuredModel} model`);
            return { message, model: configuredModel };
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
