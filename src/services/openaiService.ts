import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyInvalidError } from '../models/errors';
import { extractAndValidateMessage, handleHttpError } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ApiKeyManager } from './apiKeyManager';
import { toError } from '../utils/errorUtils';

interface OpenAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

interface ModelsResponse {
    data: Array<{
        id: string;
        ownedBy?: string;
    }>;
}

export class OpenAIService {
    private static readonly chatCompletionsPath = '/chat/completions';
    private static readonly modelsPath = '/models';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        try {
            const apiKey = await ApiKeyManager.getKey('openai');
            const model = ConfigService.getOpenAIModel();
            const baseUrl = ConfigService.getOpenAIBaseUrl();

            const payload = {
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                max_tokens: options?.maxTokens ?? 1024
            };

            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const headers = HttpUtils.createRequestHeaders(apiKey);
            const requestConfig = HttpUtils.createRequestConfig(
                headers,
                undefined,
                options?.signal
            );

            const response = await axios.post<OpenAIResponse>(
                `${baseUrl}${this.chatCompletionsPath}`,
                payload,
                requestConfig
            );

            progress.report({ message: 'Processing generated message...', increment: 90 });

            const message = this.extractCommitMessage(response.data);
            Logger.log(`Commit message generated using ${model} model`);
            return { message, model };
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 401) {
                throw new ApiKeyInvalidError('OpenAI');
            }

            return RetryUtils.handleGenerationError(
                toError(error),
                prompt,
                progress,
                attempt,
                (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
                (err: Error) => handleHttpError(err, 'OpenAI API')
            );
        }
    }

    static async fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
        try {
            const headers = HttpUtils.createRequestHeaders(apiKey);
            const requestConfig = HttpUtils.createRequestConfig(headers);

            const response = await axios.get<ModelsResponse>(
                `${baseUrl}${this.modelsPath}`,
                requestConfig
            );

            if (!response.data?.data) {
                return [];
            }

            const models = response.data.data.map(model => model.id);
            if (models.length > 0) {
                Logger.log(`Successfully fetched ${models.length} models`);
            }
            return models;
        } catch {
            return [];
        }
    }

    private static extractCommitMessage(response: OpenAIResponse): string {
        const content = response.choices?.[0]?.message?.content;
        return extractAndValidateMessage(content, 'OpenAI');
    }

}
