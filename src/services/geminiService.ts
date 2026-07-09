import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyInvalidError, TruncatedResponseError } from '../models/errors';
import { extractAndValidateMessage, getConfiguredTemperature, resolveMaxOutputTokens, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpError, HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ApiKeyManager } from './apiKeyManager';
import { toError } from '../utils/errorUtils';

interface GeminiPart {
    text?: string;
    /** Set on the reasoning summary a thinking model emits ahead of its answer. */
    thought?: boolean;
}

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: GeminiPart[];
        };
        finishReason?: string;
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
} as const;

/** Gemini 2.5 Pro is the one 2.5 model that cannot switch thinking off. */
const GEMINI_PRO_MIN_THINKING_BUDGET = 128;

const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'];
const DEFAULT_THINKING_LEVEL = 'low';

// `.commitsage/config.json` is parsed leniently, so both knobs are sanitized
// here rather than trusted — a bad value would otherwise reach the API as
// `NaN` or an unknown enum and come back as a 400.
function readThinkingBudget(): number {
    const raw = ConfigService.get('gemini.thinkingBudget');
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0;
}

function readThinkingLevel(): string {
    const raw = ConfigService.get('gemini.thinkingLevel');
    return THINKING_LEVELS.includes(raw) ? raw : DEFAULT_THINKING_LEVEL;
}

/**
 * `thinkingConfig` is family-specific and the API rejects the wrong knob with
 * HTTP 400 ("Thinking level is not supported for this model"), so gate on the
 * model version rather than sending both:
 *   - Gemini 3.x         → `thinkingLevel` (thinking cannot be disabled)
 *   - Gemini 2.5         → `thinkingBudget` (`0` disables, `-1` = model decides)
 *   - Gemini 2.0, Gemma  → no thinking support, send nothing
 *
 * This exists because thinking tokens are drawn from `maxOutputTokens`. Left
 * unbounded, the model spends the whole budget reasoning and its commit message
 * comes back cut off mid-line, or the reasoning summary is returned in place of
 * the message (#447).
 */
function buildThinkingConfig(model: string): Record<string, unknown> | undefined {
    if (!model.startsWith('gemini-')) {
        return undefined;
    }
    const version = geminiVersionScore(model);

    if (version >= 3) {
        return { thinkingLevel: readThinkingLevel() };
    }
    if (version >= 2.5) {
        const budget = readThinkingBudget();
        if (budget < 0) {
            return { thinkingBudget: -1 };
        }
        const floor = model.includes('pro') ? GEMINI_PRO_MIN_THINKING_BUDGET : 0;
        return { thinkingBudget: Math.max(budget, floor) };
    }
    return undefined;
}

function buildGeminiGenerationConfig(model: string, options?: GenerateOptions, attempt: number = 1): Record<string, unknown> {
    const cfg: Record<string, unknown> = {
        ...GEMINI_GENERATION_CONFIG_BASE,
        temperature: getConfiguredTemperature(),
        maxOutputTokens: resolveMaxOutputTokens(options, attempt),
    };
    const thinkingConfig = buildThinkingConfig(model);
    if (thinkingConfig) {
        cfg.thinkingConfig = thinkingConfig;
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

/**
 * Models Google's `/v1/models` advertises for `generateContent` that still can't
 * write a commit message: image/audio/TTS/embedding variants, plus the Gemma and
 * LearnLM families (which also reject `thinkingConfig`). A denylist of markers
 * rather than an allowlist of names, so new Gemini text models appear on their own.
 */
const NON_TEXT_MODEL_MARKER = /image|audio|tts|live|vision|embedding|imagen|veo/;

function isCommitCapableGeminiModel(name: string): boolean {
    return name.startsWith('gemini-') && !NON_TEXT_MODEL_MARKER.test(name);
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

            const models = (data.models ?? [])
                .filter((model: GeminiModel) =>
                    model.supportedGenerationMethods?.includes('generateContent')
                )
                .map((model: GeminiModel) => model.name.replace('models/', ''))
                .filter(isCommitCapableGeminiModel);

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

    /**
     * One `generateContent` call for a specific model. Single home for the
     * url + payload + post + extract shared by auto-mode (loop over models) and
     * the single-model branch — they differ only in surrounding progress
     * reporting and retry/error policy, which stay at the call sites.
     */
    private static async callGemini(
        model: string,
        prompt: string,
        apiKey: string,
        options?: GenerateOptions,
        attempt: number = 1,
    ): Promise<CommitMessage> {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: buildGeminiGenerationConfig(model, options, attempt),
        };
        const data = await HttpUtils.postJson<GeminiResponse>(apiUrl, payload, {
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            signal: options?.signal,
        });
        return { message: this.extractCommitMessage(data, model), model };
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

                const result = await this.callGemini(model, prompt, apiKey, options);
                Logger.log(`Commit message successfully generated using ${model} model (auto mode)`);

                progress.report({ message: 'Processing generated message...', increment: 100 });
                return result;

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
                await RetryUtils.updateProgressForAttempt(progress, attempt);
                const result = await this.callGemini(configuredModel, prompt, apiKey, options, attempt);
                progress.report({ message: 'Processing generated message...', increment: 90 });
                Logger.log(`Commit message generated using ${configuredModel} model`);
                return result;
            }
        );
    }

    private static extractCommitMessage(response: GeminiResponse, model: string): string {
        const candidate = response.candidates?.[0];

        // A truncated message reads as a valid one — the last line is simply cut
        // off — so this has to be checked before the text, not after it fails.
        if (candidate?.finishReason === 'MAX_TOKENS') {
            throw new TruncatedResponseError('Gemini', `${model} exhausted maxOutputTokens`);
        }

        // Thinking models return their reasoning summary as its own part ahead of
        // the answer. Reading `parts[0]` blindly surfaced that summary as the
        // commit message (#447); take every part that isn't a thought.
        const content = (candidate?.content?.parts ?? [])
            .filter(part => !part.thought)
            .map(part => part.text ?? '')
            .join('');

        return extractAndValidateMessage(content, 'Gemini');
    }

}
