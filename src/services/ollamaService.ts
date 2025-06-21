import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter, IAIService } from '../models/types';
import { ConfigService } from '../utils/configService';
import { BaseAIService } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';

interface OllamaResponse {
    message: {
        content: string;
    };
}

interface ApiErrorResponse {
    status: number;
    data: unknown;
}

type ErrorWithResponse = AxiosError & {
    response?: ApiErrorResponse;
};

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
            void Logger.log(`Attempt ${attempt}: Sending request to Ollama API`);
            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const requestConfig = HttpUtils.createRequestConfig(
                { 'content-type': 'application/json' }
            );

            const response = await axios.post<OllamaResponse>(apiUrl, payload, requestConfig);

            void Logger.log('Ollama API response received successfully');
            progress.report({ message: "Processing generated message...", increment: 100 });

            const commitMessage = this.extractCommitMessage(response.data);
            void Logger.log(`Commit message generated using ${model} model`);
            return { message: commitMessage, model };
        } catch (error) {
            // Используем retry utils для retry логики
            return RetryUtils.handleGenerationError(
                error as Error,
                prompt,
                progress,
                attempt,
                this.generateCommitMessage.bind(this),
                BaseAIService.handleOllamaError.bind(BaseAIService)
            );
        }
    }

    private static extractCommitMessage(response: OllamaResponse): string {
        const content = response.message?.content;
        return BaseAIService.extractAndValidateMessage(content, 'Ollama');
    }


}
