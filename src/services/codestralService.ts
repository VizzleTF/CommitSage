import { ConfigService } from '../utils/configService';
import type { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyManager } from './apiKeyManager';
import { generateViaOpenAICompatible } from './openAICompatibleService';

export class CodestralService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions,
    ): Promise<CommitMessage> {
        const apiKey = await ApiKeyManager.getKey('codestral');
        return generateViaOpenAICompatible(
            {
                providerLabel: 'Codestral',
                baseUrl: 'https://codestral.mistral.ai/v1',
                apiKey,
                model: ConfigService.get('codestral.model'),
            },
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            options,
        );
    }
}
