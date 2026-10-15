import { CommitMessage, ProgressReporter, GenerateOptions, ApiErrorResult } from '../models/types';
import { ConfigService } from '../utils/configService';
import { extractAndValidateMessage, getConfiguredTemperature, handleHttpError, resolveMaxOutputTokens, sendWithThinkingLadder, ThinkingLadder, withRetryAndApiKeyGuard } from './baseAIService';
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

// Ollama errors only on `think: true` for a model that cannot think, so
// `false` is safe for every model.
const OLLAMA_THINKING_LADDER: ThinkingLadder = [{ think: false }];

// Ollama's default window is 4096 tokens on machines with under 24 GiB of
// VRAM, and an overflowing prompt loses its start: the format instructions.
const OLLAMA_DEFAULT_CTX = 4096;
// Room for the reply: a commit message plus some thinking. `num_predict` is
// a ceiling (4096 by default), so reserving all of it would always overflow.
const REPLY_RESERVE = 1024;

/**
 * The `num_ctx` to send when the user left `ollama.numCtx` at 0: undefined
 * while the prompt fits the default window, otherwise the next power of two
 * that holds it (~3 chars per token) plus room for the reply. Powers of two
 * keep the number of distinct values low, since each change reloads the
 * model; Ollama itself caps the value at the model's trained context.
 */
export function autoNumCtx(promptLength: number): number | undefined {
    const needed = Math.ceil(promptLength / 3) + REPLY_RESERVE;
    return needed <= OLLAMA_DEFAULT_CTX ? undefined : 2 ** Math.ceil(Math.log2(needed));
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
            // Ollama nests sampling parameters under `options`. `temperature`
            // stays conditional so Ollama keeps its per-model default, and
            // `num_ctx` is sent only when the prompt needs it; `num_predict` carries
            // the shared output budget, which local reasoning models also draw
            // their thinking from.
            const ollamaOptions: Record<string, unknown> = {};
            const temperature = getConfiguredTemperature();
            if (temperature !== undefined) {
                ollamaOptions.temperature = temperature;
            }
            ollamaOptions['num_predict'] = resolveMaxOutputTokens(options, attempt);
            const contextLength = typeof numCtx === 'number' && numCtx > 0
                ? numCtx
                : autoNumCtx(prompt.length);
            if (contextLength !== undefined) {
                ollamaOptions['num_ctx'] = contextLength;
            }
            const data = await sendWithThinkingLadder(`ollama|${apiUrl}|${model}`, OLLAMA_THINKING_LADDER, thinking =>
                HttpUtils.postJson<OllamaResponse>(apiUrl, {
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                    options: ollamaOptions,
                    ...thinking,
                }, {
                    headers: HttpUtils.createRequestHeaders(authToken),
                    signal: options?.signal,
                }));

            return { message: this.extractCommitMessage(data), model };
        }, { signal: options?.signal, errorMapper: this.mapOllamaError });
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
