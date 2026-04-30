import { ApiErrorResult, CommitMessage, ProgressReporter } from '../models/types';
import { errorMessages } from '../utils/constants';
import { ApiKeyInvalidError } from '../models/errors';
import { RetryUtils } from '../utils/retryUtils';
import { toError } from '../utils/errorUtils';
import { AxiosError } from 'axios';

/**
 * Wraps the per-attempt body of an HTTP-LLM provider with the shared
 * error-handling envelope: throw `ApiKeyInvalidError` on HTTP 401 (so
 * `commitWorkflow.handleInvalidApiKey` reprompts the user), otherwise
 * delegate to `RetryUtils.handleGenerationError` for retry/backoff
 * with `handleHttpError` as the mapper.
 *
 * Used by OpenAI, Codestral, and Gemini's single-model branch. Ollama
 * duplicates the 401 throw outside this helper because its 404/500
 * mapping is structurally different (no `WWW-Authenticate` semantics on
 * a self-hosted server).
 */
export async function withRetryAndApiKeyGuard(
    name: string,
    prompt: string,
    progress: ProgressReporter,
    attempt: number,
    retryFn: (prompt: string, progress: ProgressReporter, attempt: number) => Promise<CommitMessage>,
    fn: () => Promise<CommitMessage>
): Promise<CommitMessage> {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 401) {
            throw new ApiKeyInvalidError(name);
        }
        return RetryUtils.handleGenerationError(
            toError(error),
            prompt,
            progress,
            attempt,
            retryFn,
            (err: Error) => handleHttpError(err, `${name} API`)
        );
    }
}

export function validateCommitMessage(message: string): string {
    const cleanMessage = message.trim();
    if (!cleanMessage) {
        throw new Error('Generated commit message is empty.');
    }
    return cleanMessage;
}

export function extractAndValidateMessage(
    content: string | undefined | null,
    serviceName: string,
): string {
    if (!content) {
        throw new Error(`Invalid response format from ${serviceName} API`);
    }
    return validateCommitMessage(content);
}

export function handleHttpError(error: Error, serviceName: string): ApiErrorResult {
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
                        statusCode: status,
                    };
                case 402:
                    return {
                        errorMessage: errorMessages.paymentRequired,
                        shouldRetry: false,
                        statusCode: status,
                    };
                case 429:
                    return {
                        errorMessage: errorMessages.rateLimitExceeded,
                        shouldRetry: true,
                        statusCode: status,
                    };
                case 422:
                    return {
                        errorMessage: errorMessage || errorMessages.invalidRequest,
                        shouldRetry: false,
                        statusCode: status,
                    };
                case 500:
                    return {
                        errorMessage: errorMessages.serverError,
                        shouldRetry: true,
                        statusCode: status,
                    };
                default: {
                    const responseData = JSON.stringify(error.response.data);
                    return {
                        errorMessage: `${errorMessages.apiError.replace('{0}', String(status))}: ${errorMessage || responseData}`,
                        shouldRetry: status >= 500,
                        statusCode: status,
                    };
                }
            }
        }

        if (
            error.code === 'ECONNREFUSED' ||
            error.code === 'ETIMEDOUT' ||
            error.message?.includes('ECONNREFUSED') ||
            error.message?.includes('ETIMEDOUT')
        ) {
            return {
                errorMessage: `Could not connect to ${serviceName}. Please check your internet connection.`,
                shouldRetry: true,
            };
        }
    }

    return {
        errorMessage: error.message || 'Unknown error',
        shouldRetry: false,
    };
}
