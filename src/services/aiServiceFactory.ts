import { CommitMessage, ProgressReporter } from '../models/types';
import { GeminiService } from './geminiService';
import { OpenAIService } from './openaiService';
import { CodestralService } from './codestralService';
import { OllamaService } from './ollamaService';

/**
 * Enum для всех доступных AI сервисов
 */
export enum AIServiceType {
    GEMINI = 'gemini',
    OPENAI = 'openai',
    CODESTRAL = 'codestral',
    OLLAMA = 'ollama'
}

/**
 * Тип для базовых AI сервисов (только generateCommitMessage)
 */
type AIServiceClass = {
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number
    ): Promise<CommitMessage>;
};

/**
 * Фабрика для создания и получения AI сервисов
 */
export class AIServiceFactory {
    private static readonly services: Record<AIServiceType, AIServiceClass> = {
        [AIServiceType.GEMINI]: GeminiService,
        [AIServiceType.OPENAI]: OpenAIService,
        [AIServiceType.CODESTRAL]: CodestralService,
        [AIServiceType.OLLAMA]: OllamaService
    };

    private static getService(type: AIServiceType): AIServiceClass {
        const service = this.services[type];
        if (!service) {
            throw new Error(`AI service type '${type}' is not supported`);
        }
        return service;
    }

    /**
     * Универсальный метод для генерации commit сообщения
     */
    static async generateCommitMessage(
        type: AIServiceType,
        prompt: string,
        progress: ProgressReporter,
        attempt?: number
    ): Promise<CommitMessage> {
        const service = this.getService(type);
        return service.generateCommitMessage(prompt, progress, attempt);
    }
}
