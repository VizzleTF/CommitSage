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
export interface IAIService {
    generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt?: number
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
        commitLanguage?: 'english' | 'russian' | 'chinese' | 'japanese' | 'spanish';
        commitFormat?: 'conventional' | 'angular' | 'karma' | 'semantic' | 'emoji' | 'emojiKarma' | 'google' | 'atom';
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
