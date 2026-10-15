import { CommitMessage, ProgressReporter, GenerateOptions, ApiErrorResult } from '../models/types';
import { ConfigService } from '../utils/configService';
import { extractAndValidateMessage, getConfiguredTemperature, handleHttpError, resolveMaxOutputTokens, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpError, HttpUtils, NetworkError } from '../utils/httpUtils';
import { ApiKeyManager } from './apiKeyManager';
import { TruncatedResponseError } from '../models/errors';

interface OllamaResponse {
    message: {
        content: string;
    };
    // eslint-disable-next-line @typescript-eslint/naming-convention
    done_reason?: string;
}

export class OllamaService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        const apiUrl = `${HttpUtils.stripTrailingSlashes(ConfigService.get('ollama.baseUrl'))}/api/chat`;
        const model = ConfigService.get('ollama.model');
        const numCtx = ConfigService.get('ollama.numCtx');
        // Auth is opt-in for self-hosted Ollama: a token left in SecretStorage
        // after the toggle is switched off must not be sent.
        const authToken = ConfigService.get('ollama.useAuthToken')
            ? await ApiKeyManager.getOptionalKey('ollama')
            : undefined;

        return withRetryAndApiKeyGuard('Ollama', progress, async attempt => {
            // Ollama nests sampling parameters under `options`. `num_ctx` stays
            // conditional so Ollama keeps its own per-model default when the user
            // hasn't overridden it; `num_predict` carries the shared output budget,
            // which local reasoning models also draw their thinking from.
            const ollamaOptions: Record<string, unknown> = { temperature: getConfiguredTemperature() };
            ollamaOptions['num_predict'] = resolveMaxOutputTokens(options, attempt);
            if (typeof numCtx === 'number' && numCtx > 0) {
                ollamaOptions['num_ctx'] = numCtx;
            }
            const payload = {
                model,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                options: ollamaOptions,
            };

            const data = await HttpUtils.postJson<OllamaResponse>(apiUrl, payload, {
                headers: HttpUtils.createRequestHeaders(authToken),
                signal: options?.signal,
            });

            return { message: this.extractCommitMessage(data), model };
        }, this.mapOllamaError);
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
        // Ollama reports `length` when generation stopped at `num_predict`.
        if (response.done_reason === 'length') {
            throw new TruncatedResponseError('Ollama', 'generation stopped at num_predict');
        }
        const content = response.message?.content;
        return extractAndValidateMessage(content, 'Ollama');
    }

}
