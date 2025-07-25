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
 * 
 * @example
 * ```typescript
 * class MyAIService implements IAIService {
 *     static async generateCommitMessage(prompt: string, progress: ProgressReporter): Promise<CommitMessage> {
 *         // Implementation here
 *     }
 * }
 * ```
 */
export interface IAIService {
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number
    ): Promise<CommitMessage>;
}

/**
 * Расширенный интерфейс для сервисов с поддержкой получения списка моделей
 * Наследует IAIService и добавляет возможность получения доступных моделей
 * 
 * @example
 * ```typescript
 * class OpenAIService implements IModelService {
 *     static async generateCommitMessage(...) { ... }
 *     static async fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
 *         // Fetch and return available models
 *     }
 * }
 * ```
 */
export interface IModelService extends IAIService {
    fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]>;
}

/**
 * Интерфейс для конструктора AI сервиса (для статических методов)
 * Используется для типизации классов с статическими методами
 */
export interface IAIServiceConstructor {
    new(): IAIService;
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number
    ): Promise<CommitMessage>;
}

/**
 * Интерфейс для конструктора сервиса с моделями (для статических методов)
 * Расширяет IAIServiceConstructor добавляя поддержку получения моделей
 */
export interface IModelServiceConstructor extends IAIServiceConstructor {
    fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]>;
}

/**
 * Конфигурация для обработки ошибок API
 * Содержит настройки retry логики и таймаутов
 */
export interface ApiErrorHandlingConfig {
    maxRetries: number;
    retryDelay: number;
    maxRetryBackoff: number;
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
 * Стандартизированная ошибка API
 * Унифицированная структура для всех API ошибок
 */
export interface ApiError {
    status: number;
    message: string;
    retryable: boolean;
    response?: unknown;
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
        commitLanguage?: 'english' | 'russian' | 'chinese' | 'japanese' | 'spanish';
        commitFormat?: 'conventional' | 'angular' | 'karma' | 'semantic' | 'emoji' | 'emojiKarma';
        useCustomInstructions?: boolean;
        customInstructions?: string;
        onlyStagedChanges?: boolean;
        autoCommit?: boolean;
        autoPush?: boolean;
        promptForRefs?: boolean;
    };
    gemini?: {
        model?: 'gemini-1.0-pro' | 'gemini-1.5-pro' | 'gemini-1.5-flash' | 'gemini-2.0-flash-exp';
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