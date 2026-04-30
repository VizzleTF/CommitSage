import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyInvalidError } from '../models/errors';
import { extractAndValidateMessage, withRetryAndApiKeyGuard } from './baseAIService';
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

export class GeminiService {
    private static async getAvailableModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
        try {
            const apiUrl = 'https://generativelanguage.googleapis.com/v1/models';
            const requestConfig = HttpUtils.createRequestConfig(
                { 'x-goog-api-key': apiKey },
                undefined,
                signal
            );

            const response = await axios.get<GeminiModelsResponse>(apiUrl, requestConfig);

            const models = response.data.models
                .filter((model: GeminiModel) =>
                    model.supportedGenerationMethods?.includes('generateContent')
                )
                .map((model: GeminiModel) => model.name.replace('models/', ''));

            Logger.log(`Found ${models.length} available Gemini models: ${models.join(', ')}`);
            return models;
        } catch (error) {
            Logger.error('Failed to fetch available Gemini models:', toError(error));
            return [
                'gemini-2.5-flash',
                'gemini-2.5-pro',
                'gemini-2.5-flash-lite',
                'gemini-3-flash-preview'
            ];
        }
    }

    private static async tryGenerateWithModels(
        prompt: string,
        progress: ProgressReporter,
        models: string[],
        apiKey: string,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        const errors: Array<{ model: string; error: string; status?: number }> = [];

        for (const model of models) {
            try {
                progress.report({
                    message: `Trying model ${model}...`,
                    increment: 0
                });

                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: options?.maxTokens
                        ? { ...GEMINI_GENERATION_CONFIG, maxOutputTokens: options.maxTokens }
                        : GEMINI_GENERATION_CONFIG
                };

                const requestConfig = HttpUtils.createRequestConfig(
                    { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
                    undefined,
                    options?.signal
                );

                const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);

                const message = this.extractCommitMessage(response.data);
                Logger.log(`Commit message successfully generated using ${model} model (auto mode)`);

                progress.report({ message: 'Processing generated message...', increment: 100 });
                return { message, model };

            } catch (error) {
                const status = error instanceof AxiosError ? error.response?.status : undefined;
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push({ model, error: errorMsg, status });
                Logger.log(`Model ${model} failed: ${errorMsg}`);
            }
        }

        const allUnauthorized = errors.length > 0 && errors.every(e => e.status === 401);
        if (allUnauthorized) {
            throw new ApiKeyInvalidError('Gemini');
        }

        throw new Error(`All models failed. Errors: ${errors.map(e => `${e.model}: ${e.error}`).join('; ')}`);
    }

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        const apiKey = await ApiKeyManager.getKey('gemini');
        const configuredModel = ConfigService.get('gemini.model');

        // Auto-mode is structurally different (loops over models, accumulates
        // 401s rather than failing fast), so it bypasses the helper.
        if (configuredModel === 'auto') {
            progress.report({ message: 'Fetching available Gemini models...', increment: 0 });
            const availableModels = await this.getAvailableModels(apiKey, options?.signal);

            if (availableModels.length === 0) {
                throw new Error('No available Gemini models found');
            }

            return this.tryGenerateWithModels(prompt, progress, availableModels, apiKey, options);
        }

        return withRetryAndApiKeyGuard(
            'Gemini',
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            async () => {
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${configuredModel}:generateContent`;

                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: options?.maxTokens
                        ? { ...GEMINI_GENERATION_CONFIG, maxOutputTokens: options.maxTokens }
                        : GEMINI_GENERATION_CONFIG
                };

                await RetryUtils.updateProgressForAttempt(progress, attempt);

                const requestConfig = HttpUtils.createRequestConfig(
                    { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
                    undefined,
                    options?.signal
                );

                const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);
                progress.report({ message: 'Processing generated message...', increment: 90 });

                const message = extractAndValidateMessage(
                    response.data.candidates?.[0]?.content?.parts?.[0]?.text,
                    'Gemini'
                );
                Logger.log(`Commit message generated using ${configuredModel} model`);
                return { message, model: configuredModel };
            }
        );
    }

    private static extractCommitMessage(response: GeminiResponse): string {
        const content = response.candidates?.[0]?.content?.parts?.[0]?.text;
        return extractAndValidateMessage(content, 'Gemini');
    }

}
