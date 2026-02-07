import { ApiErrorResult } from '../models/types';
import { errorMessages } from '../utils/constants';
import { AxiosError } from 'axios';

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
        if (error instanceof AxiosError) {
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data as { error?: { message?: string } };
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
                    default: {
                        const responseData = JSON.stringify(error.response.data);
                        return {
                            errorMessage: `${errorMessages.apiError.replace('{0}', String(status))}: ${errorMessage || responseData}`,
                            shouldRetry: status >= 500,
                            statusCode: status
                        };
                    }
                }
            }

            // Сетевые ошибки Axios
            if (error.code === 'ECONNREFUSED' ||
                error.code === 'ETIMEDOUT' ||
                error.message?.includes('ECONNREFUSED') ||
                error.message?.includes('ETIMEDOUT')) {
                return {
                    errorMessage: `Could not connect to ${serviceName}. Please check your internet connection.`,
                    shouldRetry: true
                };
            }
        }

        return {
            errorMessage: error.message || 'Unknown error',
            shouldRetry: false
        };
    }

} 