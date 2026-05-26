import { ConfigService } from './configService';

/**
 * Thrown for non-2xx HTTP responses. Replaces `AxiosError.response` after
 * the migration to native `fetch`. `data` is the parsed JSON body if the
 * response was JSON, otherwise the raw text. Consumers (`baseAIService.handleHttpError`)
 * read `.status` and dig into `.data?.error?.message` for provider error strings.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly data: unknown;

  constructor(status: number, data: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Network-layer failure — DNS, connection refused, request timeout. Anything
 * `fetch` rejects with TypeError or TimeoutError is normalized into this.
 * Carries the original cause so `handleHttpError` can map ECONNREFUSED/ETIMEDOUT.
 */
export class NetworkError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

interface RequestOptions {
  headers: Record<string, string>;
  signal?: AbortSignal;
  /** Override the configured timeout. -1 disables the timeout. */
  timeoutMs?: number;
}

/**
 * How a provider expects its API key to be transmitted.
 * - `bearer` — `Authorization: Bearer <key>` (OpenAI, Groq, OpenRouter, DeepSeek, xAI, Codestral, Ollama auth)
 * - `x-api-key` — `x-api-key: <key>` (Anthropic)
 * - `none` — no auth header, even if `apiKey` is provided (custom self-hosted)
 */
export type AuthStyle = 'bearer' | 'x-api-key' | 'none';

export class HttpUtils {
  static createRequestHeaders(
    apiKey?: string,
    additionalHeaders?: Record<string, string>,
    authStyle: AuthStyle = 'bearer',
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...additionalHeaders,
    };

    if (apiKey && authStyle !== 'none') {
      if (authStyle === 'x-api-key') {
        headers['x-api-key'] = apiKey;
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    return headers;
  }

  private static getConfiguredTimeoutMs(): number | undefined {
    const timeoutSeconds = ConfigService.get('apiRequestTimeout');
    return timeoutSeconds === -1 ? undefined : timeoutSeconds * 1000;
  }

  private static resolveSignal(
    externalSignal: AbortSignal | undefined,
    timeoutMs: number | undefined,
  ): AbortSignal | undefined {
    if (timeoutMs === undefined) {
      return externalSignal;
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!externalSignal) {
      return timeoutSignal;
    }
    return AbortSignal.any([externalSignal, timeoutSignal]);
  }

  static async getJson<T>(url: string, opts: RequestOptions): Promise<T> {
    return this.requestJson<T>('GET', url, undefined, opts);
  }

  static async postJson<T>(
    url: string,
    body: unknown,
    opts: RequestOptions,
  ): Promise<T> {
    return this.requestJson<T>('POST', url, body, opts);
  }

  private static async requestJson<T>(
    method: 'GET' | 'POST',
    url: string,
    body: unknown,
    opts: RequestOptions,
  ): Promise<T> {
    const timeoutMs =
      opts.timeoutMs === -1
        ? undefined
        : opts.timeoutMs ?? this.getConfiguredTimeoutMs();
    const signal = this.resolveSignal(opts.signal, timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: opts.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (error) {
      // External cancellation propagates as-is so withProgress's cancel button
      // surfaces directly rather than being wrapped as a network failure.
      if (
        error instanceof Error &&
        error.name === 'AbortError' &&
        opts.signal?.aborted
      ) {
        throw error;
      }
      throw new NetworkError(this.describeNetworkError(error), error);
    }

    if (!response.ok) {
      const data = await this.readResponseBody(response);
      throw new HttpError(response.status, data);
    }

    return (await response.json()) as T;
  }

  private static async readResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private static describeNetworkError(error: unknown): string {
    if (error instanceof Error) {
      // `fetch` wraps undici errors as `TypeError: fetch failed` with
      // the underlying Node error on `.cause`.
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      const code = cause?.code;
      if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
        return `${code}: ${cause?.message ?? error.message}`;
      }
      if (error.name === 'TimeoutError') {
        return 'Request timed out.';
      }
      return cause?.message ?? error.message;
    }
    return String(error);
  }
}
