import { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { Provider } from '../views/webview/protocol';
import { GeminiService } from './geminiService';
import { OllamaService } from './ollamaService';
import { AnthropicService } from './anthropicService';
import {
    generateViaOpenAICompatibleProvider,
    isOpenAICompatibleProvider,
} from './openAICompatibleService';

type AIServiceClass = {
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number,
        options?: GenerateOptions
    ): Promise<CommitMessage>;
};

/**
 * Providers with a bespoke wire format (not OpenAI `/chat/completions`):
 * Gemini (`generateContent`), Anthropic (`/v1/messages`, `x-api-key`), and
 * Ollama (`/api/chat`, self-hosted error mapping). Every other provider is
 * dispatched through `generateViaOpenAICompatibleProvider`, so it needs no
 * entry here — see `COMPAT_SPECS` in `openAICompatibleService.ts`.
 */
const NON_COMPAT_SERVICES: Partial<Record<Provider, AIServiceClass>> = {
    gemini: GeminiService,
    ollama: OllamaService,
    anthropic: AnthropicService,
};

/**
 * True when `type` resolves to a generation path — either a dedicated
 * non-compat service or the shared OpenAI-compatible dispatcher. A provider id
 * present in the catalog but in neither table would throw at generation time;
 * the completeness test guards against that drift (the original F2 risk).
 */
export function supportsProvider(type: Provider): boolean {
    return type in NON_COMPAT_SERVICES || isOpenAICompatibleProvider(type);
}

export class AIServiceFactory {
    static async generateCommitMessage(
        type: Provider,
        prompt: string,
        progress: ProgressReporter,
        attempt?: number,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        const service = NON_COMPAT_SERVICES[type];
        if (service) {
            return service.generateCommitMessage(prompt, progress, attempt, options);
        }
        if (isOpenAICompatibleProvider(type)) {
            return generateViaOpenAICompatibleProvider(type, prompt, progress, attempt, options);
        }
        throw new Error(`AI service type '${type}' is not supported`);
    }
}
