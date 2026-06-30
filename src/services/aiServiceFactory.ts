import { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { Provider } from '../views/webview/protocol';
import { GeminiService } from './geminiService';
import { OpenAIService } from './openaiService';
import { CodestralService } from './codestralService';
import { OllamaService } from './ollamaService';
import { GroqService } from './groqService';
import { OpenRouterService } from './openRouterService';
import { AnthropicService } from './anthropicService';
import { DeepSeekService } from './deepSeekService';
import { XaiService } from './xaiService';
import { CustomOpenAIService } from './customOpenAIService';

type AIServiceClass = {
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number,
        options?: GenerateOptions
    ): Promise<CommitMessage>;
};

export class AIServiceFactory {
    private static readonly services: Record<Provider, AIServiceClass> = {
        gemini: GeminiService,
        openai: OpenAIService,
        codestral: CodestralService,
        ollama: OllamaService,
        openrouter: OpenRouterService,
        groq: GroqService,
        anthropic: AnthropicService,
        deepseek: DeepSeekService,
        xai: XaiService,
        custom: CustomOpenAIService
    };

    private static getService(type: Provider): AIServiceClass {
        const service = this.services[type];
        if (!service) {
            throw new Error(`AI service type '${type}' is not supported`);
        }
        return service;
    }

    static async generateCommitMessage(
        type: Provider,
        prompt: string,
        progress: ProgressReporter,
        attempt?: number,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        const service = this.getService(type);
        return service.generateCommitMessage(prompt, progress, attempt, options);
    }
}
