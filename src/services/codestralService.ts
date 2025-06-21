import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter, IAIService } from '../models/types';
import { ConfigService } from '../utils/configService';
import { ConfigurationError } from '../models/errors';
import { BaseAIService } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';

interface CodestralResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

interface ApiErrorResponse {
    status: number;
    data: unknown;
}

type ErrorWithResponse = AxiosError & {
    response?: ApiErrorResponse;
};

// AI сервис для работы с Mistral Codestral API  
// Реализует интерфейс IAIService со статическими методами
export class CodestralService {
    private static readonly apiUrl = 'https://codestral.mistral.ai/v1/chat/completions';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1
    ): Promise<CommitMessage> {
        try {
            const apiKey = await ConfigService.getCodestralApiKey();
            const model = ConfigService.getCodestralModel();

            const payload = {
                model: model,
                messages: [{ role: "user", content: prompt }]
            };

            void Logger.log(`Attempt ${attempt}: Sending request to Codestral API`);
            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const headers = HttpUtils.createRequestHeaders(apiKey);
            const requestConfig = HttpUtils.createRequestConfig(headers);

            const response = await axios.post<CodestralResponse>(this.apiUrl, payload, requestConfig);

            void Logger.log('Codestral API response received successfully');
            progress.report({ message: "Processing generated message...", increment: 90 });

            const commitMessage = this.extractCommitMessage(response.data);
            void Logger.log(`Commit message generated using ${model} model`);
            return { message: commitMessage, model };
        } catch (error) {
            // Обработка специальных случаев для Codestral
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 401 && attempt === 1) {
                await ConfigService.removeCodestralApiKey();
                await ConfigService.promptForCodestralApiKey();
                return this.generateCommitMessage(prompt, progress, attempt + 1);
            }

            if (error instanceof ConfigurationError && attempt === 1) {
                await ConfigService.promptForCodestralApiKey();
                return this.generateCommitMessage(prompt, progress, attempt + 1);
            }

            // Используем retry utils для retry логики
            return RetryUtils.handleGenerationError(
                error as Error,
                prompt,
                progress,
                attempt,
                this.generateCommitMessage.bind(this),
                BaseAIService.handleCodestralError.bind(BaseAIService)
            );
        }
    }

    private static extractCommitMessage(response: CodestralResponse): string {
        const content = response.choices?.[0]?.message?.content;
        return BaseAIService.extractAndValidateMessage(content, 'Codestral');
    }


}
