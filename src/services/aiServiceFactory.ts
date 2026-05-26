import { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
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

export enum AIServiceType {
    GEMINI = 'gemini',
    OPENAI = 'openai',
    CODESTRAL = 'codestral',
    OLLAMA = 'ollama',
    OPENROUTER = 'openrouter',
    GROQ = 'groq',
    ANTHROPIC = 'anthropic',
    DEEPSEEK = 'deepseek',
    XAI = 'xai',
    CUSTOM = 'custom'
}

type AIServiceClass = {
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number,
        options?: GenerateOptions
    ): Promise<CommitMessage>;
};

export class AIServiceFactory {
    private static readonly services: Record<AIServiceType, AIServiceClass> = {
        [AIServiceType.GEMINI]: GeminiService,
        [AIServiceType.OPENAI]: OpenAIService,
        [AIServiceType.CODESTRAL]: CodestralService,
        [AIServiceType.OLLAMA]: OllamaService,
        [AIServiceType.OPENROUTER]: OpenRouterService,
        [AIServiceType.GROQ]: GroqService,
        [AIServiceType.ANTHROPIC]: AnthropicService,
        [AIServiceType.DEEPSEEK]: DeepSeekService,
        [AIServiceType.XAI]: XaiService,
        [AIServiceType.CUSTOM]: CustomOpenAIService
    };

    private static getService(type: AIServiceType): AIServiceClass {
        const service = this.services[type];
        if (!service) {
            throw new Error(`AI service type '${type}' is not supported`);
        }
        return service;
    }

    static async generateCommitMessage(
        type: AIServiceType,
        prompt: string,
        progress: ProgressReporter,
        attempt?: number,
        options?: GenerateOptions
    ): Promise<CommitMessage> {
        const service = this.getService(type);
        return service.generateCommitMessage(prompt, progress, attempt, options);
    }
}
