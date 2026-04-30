import { ConfigService } from './configService';

export class HttpUtils {
  static createRequestHeaders(
    apiKey?: string,
    additionalHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...additionalHeaders,
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private static getConfiguredTimeout(): number | undefined {
    const timeoutSeconds = ConfigService.getApiRequestTimeout();
    if (timeoutSeconds === -1) {
      // axios treats undefined as "no timeout"
      return undefined;
    }
    return timeoutSeconds * 1000;
  }

  static createRequestConfig(
    headers: Record<string, string>,
    timeout?: number,
    signal?: AbortSignal,
  ): {
    headers: Record<string, string>;
    timeout: number | undefined;
    signal?: AbortSignal;
  } {
    return {
      headers,
      timeout: timeout !== undefined ? timeout : this.getConfiguredTimeout(),
      signal,
    };
  }
}
