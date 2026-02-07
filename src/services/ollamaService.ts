import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { ConfigService } from '../utils/configService';
import { BaseAIService } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { toError } from '../utils/errorUtils';

interface OllamaResponse {
    message: {
        content: string;
    };
}

// AI сервис для работы с локальным Ollama API
// Реализует интерфейс IAIService со статическими методами
export class OllamaService {
    private static readonly defaultModel = 'llama3.2';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        const baseUrl = ConfigService.getOllamaBaseUrl() || 'http://localhost:11434';
        const model = ConfigService.getOllamaModel() || this.defaultModel;
        const apiUrl = `${baseUrl}/api/chat`;

        const payload = {
            model: model,
            messages: [
                { role: "user", content: prompt }
            ],
            stream: false
        };

        try {
            Logger.log(`Attempt ${attempt}: Sending request to Ollama API`);
            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const requestConfig = HttpUtils.createRequestConfig(
                { 'content-type': 'application/json' }
            );

            const response = await axios.post<OllamaResponse>(apiUrl, payload, requestConfig);

            Logger.log('Ollama API response received successfully');
            progress.report({ message: "Processing generated message...", increment: 100 });

            const commitMessage = this.extractCommitMessage(response.data);
            Logger.log(`Commit message generated using ${model} model`);
            return { message: commitMessage, model };
        } catch (error) {
            // Используем retry utils для retry логики
            return RetryUtils.handleGenerationError(
                toError(error),
                prompt,
                progress,
                attempt,
                this.generateCommitMessage.bind(this),
                (err: Error) => {
                    if (err instanceof AxiosError && err.response?.status === 404) {
                        return {
                            errorMessage: 'Model not found. Please check if Ollama is running and the model is installed.',
                            shouldRetry: false,
                            statusCode: 404
                        };
                    }
                    const result = BaseAIService.handleHttpError(err, 'Ollama');
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
        return BaseAIService.extractAndValidateMessage(content, 'Ollama');
    }


}
