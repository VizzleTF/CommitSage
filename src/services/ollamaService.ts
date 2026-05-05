import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { ConfigService } from '../utils/configService';
import { ApiKeyInvalidError } from '../models/errors';
import { extractAndValidateMessage, handleHttpError } from './baseAIService';
import { HttpError, HttpUtils, NetworkError } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { toError } from '../utils/errorUtils';
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
        if (options?.maxTokens !== undefined) {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            payload['options'] = { num_predict: options.maxTokens };
        }

        try {
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
        } catch (error) {
            if (error instanceof HttpError && error.status === 401) {
                throw new ApiKeyInvalidError('Ollama');
            }

            return RetryUtils.handleGenerationError(
                toError(error),
                prompt,
                progress,
                attempt,
                (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
                (err: Error) => {
                    if (err instanceof HttpError && err.status === 404) {
                        return {
                            errorMessage: 'Model not found. Please check if Ollama is running and the model is installed.',
                            shouldRetry: false,
                            statusCode: 404
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
            );
        }
    }

    private static extractCommitMessage(response: OllamaResponse): string {
        const content = response.message?.content;
        return extractAndValidateMessage(content, 'Ollama');
    }

}
