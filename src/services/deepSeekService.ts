import { ConfigService } from '../utils/configService';
import type { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyManager } from './apiKeyManager';
import { generateViaOpenAICompatible } from './openAICompatibleService';

export class DeepSeekService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions,
    ): Promise<CommitMessage> {
        const apiKey = await ApiKeyManager.getKey('deepseek');
        return generateViaOpenAICompatible(
            {
                providerLabel: 'DeepSeek',
                baseUrl: 'https://api.deepseek.com',
                apiKey,
                model: ConfigService.get('deepseek.model'),
            },
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            options,
        );
    }
}
