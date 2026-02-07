import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { ConfigService } from '../utils/configService';
import { ApiKeyInvalidError } from '../models/errors';
import { BaseAIService } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ApiKeyManager } from './apiKeyManager';
import { toError } from '../utils/errorUtils';

interface CodestralResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

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
            const apiKey = await ApiKeyManager.getKey('codestral');
            const model = ConfigService.getCodestralModel();

            const payload = {
                model: model,
                messages: [{ role: "user", content: prompt }]
            };

            Logger.log(`Attempt ${attempt}: Sending request to Codestral API`);
            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const headers = HttpUtils.createRequestHeaders(apiKey);
            const requestConfig = HttpUtils.createRequestConfig(headers);

            const response = await axios.post<CodestralResponse>(this.apiUrl, payload, requestConfig);

            Logger.log('Codestral API response received successfully');
            progress.report({ message: "Processing generated message...", increment: 90 });

            const commitMessage = this.extractCommitMessage(response.data);
            Logger.log(`Commit message generated using ${model} model`);
            return { message: commitMessage, model };
        } catch (error) {
            // Обработка специальных случаев для Codestral
            if (error instanceof AxiosError && error.response?.status === 401) {
                throw new ApiKeyInvalidError('Codestral');
            }

            // Используем retry utils для retry логики
            return RetryUtils.handleGenerationError(
                toError(error),
                prompt,
                progress,
                attempt,
                this.generateCommitMessage.bind(this),
                (err: Error) => {
                    const result = BaseAIService.handleHttpError(err, 'Codestral API');
                    if (result.statusCode === 401) {
                        result.errorMessage = 'Invalid API key. Please check your Codestral API key.';
                    }
                    return result;
                }
            );
        }
    }

    private static extractCommitMessage(response: CodestralResponse): string {
        const content = response.choices?.[0]?.message?.content;
        return BaseAIService.extractAndValidateMessage(content, 'Codestral');
    }


}
