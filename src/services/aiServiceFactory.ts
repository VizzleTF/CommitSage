import { CommitMessage, ProgressReporter, IAIService, IModelService } from '../models/types';
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
export type AIServiceClass = {
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number
    ): Promise<CommitMessage>;
};

/**
 * Тип для расширенных AI сервисов (с fetchAvailableModels)
 */
export type ModelServiceClass = AIServiceClass & {
    fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]>;
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

    private static readonly modelServices: Record<string, ModelServiceClass> = {
        [AIServiceType.OPENAI]: OpenAIService
    };

    /**
     * Получить AI сервис по типу
     */
    static getService(type: AIServiceType): AIServiceClass {
        const service = this.services[type];
        if (!service) {
            throw new Error(`AI service type '${type}' is not supported`);
        }
        return service;
    }

    /**
     * Получить сервис с поддержкой моделей по типу
     */
    static getModelService(type: AIServiceType): ModelServiceClass | null {
        return this.modelServices[type] || null;
    }

    /**
     * Проверить, поддерживает ли сервис получение списка моделей
     */
    static supportsModels(type: AIServiceType): boolean {
        return type in this.modelServices;
    }

    /**
     * Получить все доступные типы сервисов
     */
    static getAvailableServiceTypes(): AIServiceType[] {
        return Object.values(AIServiceType);
    }

    /**
     * Получить типы сервисов с поддержкой моделей
     */
    static getModelServiceTypes(): AIServiceType[] {
        return Object.keys(this.modelServices) as AIServiceType[];
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

    /**
     * Универсальный метод для получения доступных моделей
     */
    static async fetchAvailableModels(
        type: AIServiceType,
        baseUrl: string,
        apiKey: string
    ): Promise<string[]> {
        const service = this.getModelService(type);
        if (!service) {
            throw new Error(`Service '${type}' does not support model fetching`);
        }
        return service.fetchAvailableModels(baseUrl, apiKey);
    }
} 