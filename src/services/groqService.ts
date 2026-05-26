import { ConfigService } from '../utils/configService';
import type { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyManager } from './apiKeyManager';
import { generateViaOpenAICompatible } from './openAICompatibleService';

export class GroqService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions,
    ): Promise<CommitMessage> {
        const apiKey = await ApiKeyManager.getKey('groq');
        return generateViaOpenAICompatible(
            {
                providerLabel: 'Groq',
                baseUrl: 'https://api.groq.com/openai/v1',
                apiKey,
                model: ConfigService.get('groq.model'),
            },
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            options,
        );
    }
}
