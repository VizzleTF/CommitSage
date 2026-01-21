import { AxiosError } from "axios";
import { ConfigService } from "./configService";

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
    additionalHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...additionalHeaders,
    };

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private static getConfiguredTimeout(): number | undefined {
    const timeoutSeconds = ConfigService.getApiRequestTimeout();
    if (timeoutSeconds === -1) {
      return undefined; // В axios undefined означает "без таймаута"
    }
    return timeoutSeconds * 1000;
  }

  /**
   * Создание конфигурации для HTTP запросов
   */
  static createRequestConfig(
    headers: Record<string, string>,
    timeout?: number,
  ): { headers: Record<string, string>; timeout: number | undefined } {
    return {
      headers,
      timeout: timeout !== undefined ? timeout : this.getConfiguredTimeout(),
    };
  }

  /**
   * Проверка на сетевые ошибки
   */
  static isNetworkError(error: AxiosError): boolean {
    return (
      error.code === "ECONNREFUSED" ||
      error.code === "ETIMEDOUT" ||
      error.message?.includes("ECONNREFUSED") ||
      error.message?.includes("ETIMEDOUT") ||
      false
    );
  }

  /**
   * Извлечение сообщения об ошибке из ответа API
   */
  static extractErrorMessage(responseData: {
    error?: { message?: string };
  }): string | undefined {
    return responseData?.error?.message;
  }
}
