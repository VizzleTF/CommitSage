import type { CommitLanguage } from '../utils/constants';

export interface CommitMessage {
    message: string;
    model: string;
}

export interface ProgressReporter {
    report(value: { message?: string; increment?: number }): void;
}

/**
 * Базовый интерфейс для всех AI сервисов
 * Определяет основной контракт для генерации commit сообщений
 */
export interface GenerateOptions {
    maxTokens?: number;
}

export interface IAIService {
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number,
        options?: GenerateOptions
    ): Promise<CommitMessage>;
}

/**
 * Расширенный интерфейс для сервисов с поддержкой получения списка моделей
 */
export interface IModelService extends IAIService {
    fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]>;
}

/**
 * Результат обработки ошибки API
 * Содержит информацию о том, следует ли повторить запрос
 */
export interface ApiErrorResult {
    errorMessage: string;
    shouldRetry: boolean;
    statusCode?: number;
}

/**
 * Интерфейс для настроек проекта из файла .commitsage
 * Позволяет переопределить настройки расширения на уровне проекта
 */
export interface ProjectConfig {
    provider?: {
        type?: 'gemini' | 'codestral' | 'openai' | 'ollama';
    };
    commit?: {
        commitLanguage?: CommitLanguage | 'custom';
        customLanguageName?: string;
        commitFormat?: 'conventional' | 'angular' | 'karma' | 'semantic' | 'emoji' | 'emojiKarma' | 'google' | 'atom';
        useCustomInstructions?: boolean;
        customInstructions?: string;
        onlyStagedChanges?: boolean;
        autoCommit?: boolean;
        autoPush?: boolean;
        promptForRefs?: boolean;
    };
    gemini?: {
        model?: 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.5-flash-lite' | 'gemini-3-flash-preview' | 'gemini-3-pro-preview' | 'gemini-3.1-flash-lite-preview' | 'gemini-3.1-pro-preview';
    };
    codestral?: {
        model?: 'codestral-2405' | 'codestral-latest';
    };
    openai?: {
        model?: string;
        baseUrl?: string;
    };
    ollama?: {
        baseUrl?: string;
        model?: string;
    };
    telemetry?: {
        enabled?: boolean;
    };
}
