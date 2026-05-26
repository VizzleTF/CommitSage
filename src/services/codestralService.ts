import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { ConfigService } from '../utils/configService';
import { extractAndValidateMessage, getConfiguredTemperature, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ApiKeyManager } from './apiKeyManager';

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
        return withRetryAndApiKeyGuard(
            'Codestral',
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            async () => {
                const apiKey = await ApiKeyManager.getKey('codestral');
                const model = ConfigService.get('codestral.model');

                const payload: Record<string, unknown> = {
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: getConfiguredTemperature()
                };
                if (options?.maxTokens !== undefined) {
                    payload['max_tokens'] = options.maxTokens;
                }

                Logger.log(`Attempt ${attempt}: Sending request to Codestral API`);
                await RetryUtils.updateProgressForAttempt(progress, attempt);

                const data = await HttpUtils.postJson<CodestralResponse>(
                    this.apiUrl,
                    payload,
                    {
                        headers: HttpUtils.createRequestHeaders(apiKey),
                        signal: options?.signal,
                    }
                );

                Logger.log('Codestral API response received successfully');
                progress.report({ message: 'Processing generated message...', increment: 90 });

                const message = extractAndValidateMessage(
                    data.choices?.[0]?.message?.content,
                    'Codestral'
                );
                Logger.log(`Commit message generated using ${model} model`);
                return { message, model };
            }
        );
    }
}
