import { ConfigService } from '../utils/configService';
import type { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyManager } from './apiKeyManager';
import { generateViaOpenAICompatible } from './openAICompatibleService';

export class XaiService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions,
    ): Promise<CommitMessage> {
        const apiKey = await ApiKeyManager.getKey('xai');
        return generateViaOpenAICompatible(
            {
                providerLabel: 'xAI',
                baseUrl: 'https://api.x.ai/v1',
                apiKey,
                model: ConfigService.get('xai.model'),
            },
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            options,
        );
    }
}
