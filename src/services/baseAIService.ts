import { ApiErrorResult, ProgressReporter, CommitMessage } from '../models/types';
import { errorMessages } from '../utils/constants';
import { AxiosError } from 'axios';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';

/**
 * Базовый утилитарный класс для всех AI сервисов
 * Предоставляет специализированную логику для AI операций и обработки ошибок
 */
export class BaseAIService {
    /**
     * Общий метод для очистки commit сообщения
     */
    static cleanCommitMessage(message: string): string {
        return message.trim();
    }

    /**
     * Общий метод для проверки пустого ответа
     */
    static validateCommitMessage(message: string): string {
        const cleanMessage = this.cleanCommitMessage(message);
        if (!cleanMessage.trim()) {
            throw new Error("Generated commit message is empty.");
        }
        return cleanMessage;
    }

    // Делегируем HTTP операции в HttpUtils
    static createRequestHeaders = HttpUtils.createRequestHeaders;
    static createRequestConfig = HttpUtils.createRequestConfig;

    // Делегируем retry операции в RetryUtils
    static updateProgressForAttempt = RetryUtils.updateProgressForAttempt;
    static calculateRetryDelay = RetryUtils.calculateRetryDelay;
    static delay = RetryUtils.delay;
    static handleGenerationError = RetryUtils.handleGenerationError;

    /**
     * Общий метод для валидации и извлечения commit сообщения из ответа
     */
    static extractAndValidateMessage(content: string | undefined | null, serviceName: string): string {
        if (!content) {
            throw new Error(`Invalid response format from ${serviceName} API`);
        }
        return this.validateCommitMessage(content);
    }

    /**
     * Универсальная обработка HTTP ошибок для всех AI сервисов
     * Стандартизирует ответы на основе статус кодов
     */
    static handleHttpError(error: Error, serviceName: string): ApiErrorResult {
        const axiosError = error as AxiosError;

        if (axiosError.response) {
            const status = axiosError.response.status;
            const data = axiosError.response.data as { error?: { message?: string } };
            const errorMessage = data.error?.message;

            switch (status) {
                case 401:
                    return {
                        errorMessage: errorMessages.authenticationError,
                        shouldRetry: false,
                        statusCode: status
                    };
                case 402:
                    return {
                        errorMessage: errorMessages.paymentRequired,
                        shouldRetry: false,
                        statusCode: status
                    };
                case 429:
                    return {
                        errorMessage: errorMessages.rateLimitExceeded,
                        shouldRetry: true,
                        statusCode: status
                    };
                case 422:
                    return {
                        errorMessage: errorMessage || errorMessages.invalidRequest,
                        shouldRetry: false,
                        statusCode: status
                    };
                case 500:
                    return {
                        errorMessage: errorMessages.serverError,
                        shouldRetry: true,
                        statusCode: status
                    };
                default:
                    const responseData = JSON.stringify(axiosError.response.data);
                    return {
                        errorMessage: `${errorMessages.apiError.replace('{0}', String(status))}: ${errorMessage || responseData}`,
                        shouldRetry: status >= 500,
                        statusCode: status
                    };
            }
        }

        // Сетевые ошибки
        if (axiosError.code === 'ECONNREFUSED' ||
            axiosError.code === 'ETIMEDOUT' ||
            axiosError.message?.includes('ECONNREFUSED') ||
            axiosError.message?.includes('ETIMEDOUT')) {
            return {
                errorMessage: `Could not connect to ${serviceName}. Please check your internet connection.`,
                shouldRetry: true
            };
        }

        return {
            errorMessage: axiosError.message || 'Unknown error',
            shouldRetry: false
        };
    }

    /**
     * Специализированная обработка ошибок для Gemini API
     */
    static handleGeminiError(error: Error): ApiErrorResult {
        return this.handleHttpError(error, 'Gemini API');
    }

    /**
     * Специализированная обработка ошибок для OpenAI API
     */
    static handleOpenAIError(error: Error): ApiErrorResult {
        return this.handleHttpError(error, 'OpenAI API');
    }

    /**
     * Специализированная обработка ошибок для Codestral API
     */
    static handleCodestralError(error: Error): ApiErrorResult {
        const result = this.handleHttpError(error, 'Codestral API');

        // Дополнительная логика для Codestral
        if (result.statusCode === 401) {
            result.errorMessage = 'Invalid API key. Please check your Codestral API key.';
        }

        return result;
    }

    /**
     * Специализированная обработка ошибок для Ollama API
     */
    static handleOllamaError(error: Error): ApiErrorResult {
        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 404) {
            return {
                errorMessage: 'Model not found. Please check if Ollama is running and the model is installed.',
                shouldRetry: false,
                statusCode: 404
            };
        }

        const result = this.handleHttpError(error, 'Ollama');

        // Специфичные сообщения для Ollama
        if (result.shouldRetry && result.statusCode === 500) {
            result.errorMessage = 'Server error. Please check if Ollama is running properly.';
        }

        if (result.shouldRetry && !result.statusCode) {
            result.errorMessage = 'Could not connect to Ollama. Please make sure Ollama is running.';
        }

        return result;
    }
} 