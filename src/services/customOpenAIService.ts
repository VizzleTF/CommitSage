import { ConfigService } from '../utils/configService';
import type { ProgressReporter, CommitMessage, GenerateOptions } from '../models/types';
import { ApiKeyManager } from './apiKeyManager';
import { generateViaOpenAICompatible } from './openAICompatibleService';

/**
 * User-configured OpenAI-compatible endpoint. Closes LM Studio, vLLM,
 * llama.cpp server, LocalAI, Together AI, Fireworks, Cerebras, DeepInfra,
 * any private self-hosted deployment — anything that exposes the OpenAI
 * `/chat/completions` wire format at a user-supplied URL.
 *
 * `apiKey` is optional: self-hosted models often need no auth. When the
 * `custom.useApiKey` toggle is off, the key is omitted and no
 * `Authorization` header is sent.
 */
export class CustomOpenAIService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions,
    ): Promise<CommitMessage> {
        const useApiKey = ConfigService.get('custom.useApiKey');
        const apiKey = useApiKey ? await ApiKeyManager.getKey('custom') : undefined;
        return generateViaOpenAICompatible(
            {
                providerLabel: 'Custom',
                baseUrl: ConfigService.get('custom.baseUrl'),
                apiKey,
                model: ConfigService.get('custom.model'),
                chatCompletionsPath: ConfigService.get('custom.chatCompletionsPath'),
            },
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            options,
        );
    }
}
