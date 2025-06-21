import { AxiosError } from 'axios';

/**
 * Утилиты для работы с HTTP запросами
 * Общие методы для всех AI сервисов
 */
export class HttpUtils {
    static readonly DEFAULT_TIMEOUT = 30000;

    /**
     * Создание заголовков запроса с API ключом
     */
    static createRequestHeaders(
        apiKey?: string,
        additionalHeaders?: Record<string, string>
    ): Record<string, string> {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            ...additionalHeaders
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        return headers;
    }

    /**
     * Создание конфигурации для HTTP запросов
     */
    static createRequestConfig(
        headers: Record<string, string>,
        timeout?: number
    ): { headers: Record<string, string>; timeout: number } {
        return {
            headers,
            timeout: timeout || this.DEFAULT_TIMEOUT
        };
    }

    /**
     * Проверка на сетевые ошибки
     */
    static isNetworkError(error: AxiosError): boolean {
        return error.code === 'ECONNREFUSED' ||
            error.code === 'ETIMEDOUT' ||
            error.message?.includes('ECONNREFUSED') ||
            error.message?.includes('ETIMEDOUT') ||
            false;
    }

    /**
     * Извлечение сообщения об ошибке из ответа API
     */
    static extractErrorMessage(responseData: any): string | undefined {
        return responseData?.error?.message;
    }
} 