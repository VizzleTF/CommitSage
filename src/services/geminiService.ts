import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyInvalidError } from '../models/errors';
import { extractAndValidateMessage, getConfiguredTemperature, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpError, HttpUtils } from '../utils/httpUtils';
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

const GEMINI_GENERATION_CONFIG_BASE = {
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 1024
} as const;

function buildGeminiGenerationConfig(options?: GenerateOptions): Record<string, unknown> {
    const cfg: Record<string, unknown> = {
        ...GEMINI_GENERATION_CONFIG_BASE,
        temperature: getConfiguredTemperature(),
    };
    if (options?.maxTokens) {
        cfg.maxOutputTokens = options.maxTokens;
    }
    return cfg;
}

// Quality tiers for Gemini auto-mode fallback. Lower = preferred.
// pro > flash > flash-lite. Unknown / non-flash families fall into the flash
// tier so newer experimental models still beat flash-lite.
function geminiQualityTier(name: string): number {
    if (name.includes('pro')) {
        return 0;
    }
    if (name.includes('flash-lite')) {
        return 2;
    }
    return 1;
}

// Extract the leading numeric version (e.g. "gemini-2.5-flash" -> 2.5,
// "gemini-3-flash-preview" -> 3). Newer versions sort first within a tier.
function geminiVersionScore(name: string): number {
    const match = /gemini-(\d+(?:\.\d+)?)/.exec(name);
    return match ? Number.parseFloat(match[1]) : 0;
}

function sortGeminiModelsByQuality(models: string[]): string[] {
    return [...models].sort((a, b) => {
        const tierDiff = geminiQualityTier(a) - geminiQualityTier(b);
        if (tierDiff !== 0) {
            return tierDiff;
        }
        const versionDiff = geminiVersionScore(b) - geminiVersionScore(a);
        if (versionDiff !== 0) {
            return versionDiff;
        }
        return a.localeCompare(b);
    });
}

export class GeminiService {
    static async getAvailableModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
        try {
            const data = await HttpUtils.getJson<GeminiModelsResponse>(
                'https://generativelanguage.googleapis.com/v1/models',
                {
                    headers: { 'x-goog-api-key': apiKey },
                    signal,
                }
            );

            const models = data.models
                .filter((model: GeminiModel) =>
                    model.supportedGenerationMethods?.includes('generateContent')
                )
                .map((model: GeminiModel) => model.name.replace('models/', ''));

            const sorted = sortGeminiModelsByQuality(models);
            Logger.log(`Found ${sorted.length} available Gemini models (sorted by quality): ${sorted.join(', ')}`);
            return sorted;
        } catch (error) {
            Logger.error('Failed to fetch available Gemini models:', toError(error));
            return sortGeminiModelsByQuality([
                'gemini-2.5-pro',
                'gemini-2.5-flash',
                'gemini-3-flash-preview',
                'gemini-2.5-flash-lite'
            ]);
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
                    generationConfig: buildGeminiGenerationConfig(options)
                };

                const data = await HttpUtils.postJson<GeminiResponse>(apiUrl, payload, {
                    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
                    signal: options?.signal,
                });

                const message = this.extractCommitMessage(data);
                Logger.log(`Commit message successfully generated using ${model} model (auto mode)`);

                progress.report({ message: 'Processing generated message...', increment: 100 });
                return { message, model };

            } catch (error) {
                const status = error instanceof HttpError ? error.status : undefined;
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push({ model, error: errorMsg, status });
                Logger.log(`Model ${model} failed: ${errorMsg}`);
            }
        }

        const allUnauthorized = errors.length > 0 && errors.every(e => e.status === 401);
        if (allUnauthorized) {
            throw new ApiKeyInvalidError('Gemini');
        }

        const errorDetails = errors.map(e => `${e.model}: ${e.error}`).join('; ');
        throw new Error(`All models failed. Errors: ${errorDetails}`);
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
                    generationConfig: buildGeminiGenerationConfig(options)
                };

                await RetryUtils.updateProgressForAttempt(progress, attempt);

                const data = await HttpUtils.postJson<GeminiResponse>(apiUrl, payload, {
                    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
                    signal: options?.signal,
                });
                progress.report({ message: 'Processing generated message...', increment: 90 });

                const message = extractAndValidateMessage(
                    data.candidates?.[0]?.content?.parts?.[0]?.text,
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
