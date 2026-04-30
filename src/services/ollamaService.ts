import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { ConfigService } from '../utils/configService';
import { ApiKeyInvalidError } from '../models/errors';
import { extractAndValidateMessage, handleHttpError } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { toError } from '../utils/errorUtils';
import { ApiKeyManager } from './apiKeyManager';

interface OllamaResponse {
    message: {
        content: string;
    };
}

export class OllamaService {
    private static readonly defaultModel = 'llama3.2';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        const baseUrl = ConfigService.get('ollama.baseUrl') || 'http://localhost:11434';
        const model = ConfigService.get('ollama.model') || this.defaultModel;
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
            const requestConfig = HttpUtils.createRequestConfig(
                headers,
                undefined,
                options?.signal
            );

            const response = await axios.post<OllamaResponse>(apiUrl, payload, requestConfig);

            Logger.log('Ollama API response received successfully');
            progress.report({ message: 'Processing generated message...', increment: 100 });

            const commitMessage = this.extractCommitMessage(response.data);
            Logger.log(`Commit message generated using ${model} model`);
            return { message: commitMessage, model };
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 401) {
                throw new ApiKeyInvalidError('Ollama');
            }

            return RetryUtils.handleGenerationError(
                toError(error),
                prompt,
                progress,
                attempt,
                (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
                (err: Error) => {
                    if (err instanceof AxiosError && err.response?.status === 404) {
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
                    if (result.shouldRetry && !result.statusCode) {
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
