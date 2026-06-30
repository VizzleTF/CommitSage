import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter, GenerateOptions, ApiErrorResult } from '../models/types';
import { ConfigService } from '../utils/configService';
import { extractAndValidateMessage, getConfiguredTemperature, handleHttpError, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpError, HttpUtils, NetworkError } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ApiKeyManager } from './apiKeyManager';

interface OllamaResponse {
    message: {
        content: string;
    };
}

export class OllamaService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        const baseUrl = ConfigService.get('ollama.baseUrl');
        const model = ConfigService.get('ollama.model');
        const apiUrl = `${baseUrl}/api/chat`;

        const payload: Record<string, unknown> = {
            model: model,
            messages: [
                { role: 'user', content: prompt }
            ],
            stream: false
        };
        // Ollama nests sampling parameters under `options`. We always send
        // `temperature`; `num_ctx` and `num_predict` are conditional so
        // Ollama keeps its own per-model defaults when the user hasn't
        // overridden them.
        const ollamaOptions: Record<string, unknown> = { temperature: getConfiguredTemperature() };
        const numCtx = ConfigService.get('ollama.numCtx');
        if (typeof numCtx === 'number' && numCtx > 0) {
            ollamaOptions['num_ctx'] = numCtx;
        }
        if (options?.maxTokens !== undefined) {
            ollamaOptions['num_predict'] = options.maxTokens;
        }
        payload['options'] = ollamaOptions;

        return withRetryAndApiKeyGuard(
            'Ollama',
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            async () => {
                Logger.log(`Attempt ${attempt}: Sending request to Ollama API`);
                await RetryUtils.updateProgressForAttempt(progress, attempt);

                const authToken = await ApiKeyManager.getOptionalKey('ollama');
                const headers: Record<string, string> = { 'content-type': 'application/json' };
                if (authToken) {
                    headers['Authorization'] = `Bearer ${authToken}`;
                }

                const data = await HttpUtils.postJson<OllamaResponse>(apiUrl, payload, {
                    headers,
                    signal: options?.signal,
                });

                Logger.log('Ollama API response received successfully');
                progress.report({ message: 'Processing generated message...', increment: 100 });

                const commitMessage = this.extractCommitMessage(data);
                Logger.log(`Commit message generated using ${model} model`);
                return { message: commitMessage, model };
            },
            this.mapOllamaError,
        );
    }

    /**
     * Ollama is self-hosted, so its failure wording differs from the hosted
     * providers: 404 means "model not installed", 500/network mean "is Ollama
     * even running?". Everything else falls back to the shared mapping.
     */
    private static mapOllamaError(err: Error): ApiErrorResult {
        if (err instanceof HttpError && err.status === 404) {
            return {
                errorMessage: 'Model not found. Please check if Ollama is running and the model is installed.',
                shouldRetry: false,
                statusCode: 404,
            };
        }
        const result = handleHttpError(err, 'Ollama');
        if (result.shouldRetry && result.statusCode === 500) {
            result.errorMessage = 'Server error. Please check if Ollama is running properly.';
        }
        if (err instanceof NetworkError) {
            result.errorMessage = 'Could not connect to Ollama. Please make sure Ollama is running.';
        }
        return result;
    }

    private static extractCommitMessage(response: OllamaResponse): string {
        const content = response.message?.content;
        return extractAndValidateMessage(content, 'Ollama');
    }

}
