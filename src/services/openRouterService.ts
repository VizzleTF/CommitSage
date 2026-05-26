import { ConfigService } from '../utils/configService';
import type { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyManager } from './apiKeyManager';
import { generateViaOpenAICompatible } from './openAICompatibleService';

export class OpenRouterService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions,
    ): Promise<CommitMessage> {
        const apiKey = await ApiKeyManager.getKey('openrouter');
        return generateViaOpenAICompatible(
            {
                providerLabel: 'OpenRouter',
                baseUrl: 'https://openrouter.ai/api/v1',
                apiKey,
                model: ConfigService.get('openrouter.model'),
                extraHeaders: {
                    // OpenRouter recommends these headers so usage shows up
                    // attributed to the calling app on their dashboard.
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    'HTTP-Referer': 'https://github.com/VizzleTF/CommitSage',
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    'X-Title': 'Commit Sage',
                },
            },
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            options,
        );
    }
}
