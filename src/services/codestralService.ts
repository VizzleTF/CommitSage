import axios, { AxiosError } from 'axios';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
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

export class CodestralService {
    private static readonly apiUrl = 'https://codestral.mistral.ai/v1/chat/completions';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        try {
            const apiKey = await ApiKeyManager.getKey('codestral');
            const model = ConfigService.getCodestralModel();

            const payload: Record<string, unknown> = {
                model: model,
                messages: [{ role: 'user', content: prompt }]
            };
            if (options?.maxTokens !== undefined) {
                payload['max_tokens'] = options.maxTokens;
            }

            Logger.log(`Attempt ${attempt}: Sending request to Codestral API`);
            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const headers = HttpUtils.createRequestHeaders(apiKey);
            const requestConfig = HttpUtils.createRequestConfig(
                headers,
                undefined,
                options?.signal
            );

            const response = await axios.post<CodestralResponse>(this.apiUrl, payload, requestConfig);

            Logger.log('Codestral API response received successfully');
            progress.report({ message: 'Processing generated message...', increment: 90 });

            const commitMessage = this.extractCommitMessage(response.data);
            Logger.log(`Commit message generated using ${model} model`);
            return { message: commitMessage, model };
        } catch (error) {
            if (error instanceof AxiosError && error.response?.status === 401) {
                throw new ApiKeyInvalidError('Codestral');
            }

            return RetryUtils.handleGenerationError(
                toError(error),
                prompt,
                progress,
                attempt,
                (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
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
