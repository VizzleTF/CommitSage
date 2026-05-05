import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import type { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { extractAndValidateMessage, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ApiKeyManager } from './apiKeyManager';

interface OpenAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

export class OpenAIService {
    private static readonly chatCompletionsPath = '/chat/completions';

    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        return withRetryAndApiKeyGuard(
            'OpenAI',
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            async () => {
                const apiKey = await ApiKeyManager.getKey('openai');
                const model = ConfigService.get('openai.model');
                const baseUrl = ConfigService.get('openai.baseUrl');

                const payload = {
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    max_tokens: options?.maxTokens ?? 1024
                };

                await RetryUtils.updateProgressForAttempt(progress, attempt);

                const data = await HttpUtils.postJson<OpenAIResponse>(
                    `${baseUrl}${this.chatCompletionsPath}`,
                    payload,
                    {
                        headers: HttpUtils.createRequestHeaders(apiKey),
                        signal: options?.signal,
                    }
                );

                progress.report({ message: 'Processing generated message...', increment: 90 });

                const message = extractAndValidateMessage(
                    data.choices?.[0]?.message?.content,
                    'OpenAI'
                );
                Logger.log(`Commit message generated using ${model} model`);
                return { message, model };
            }
        );
    }
}
