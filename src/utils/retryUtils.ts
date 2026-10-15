import { Logger } from './logger';
import { ProgressReporter, ApiErrorResult } from '../models/types';

const MAX_RETRIES = 3;

export class RetryUtils {
    static updateProgressForAttempt(
        progress: ProgressReporter,
        attempt: number
    ): void {
        const progressMessage = attempt === 1
            ? 'Generating commit message...'
            : `Retry attempt ${attempt}/${MAX_RETRIES}...`;
        progress.report({ message: progressMessage, increment: 10 });
    }

    /** 1 s, 2 s, 4 s… each scaled by a random 0.5–1.5 so clients that failed together do not retry together. */
    static calculateRetryDelay(attempt: number): number {
        return 1000 * Math.pow(2, attempt - 1) * (0.5 + Math.random()); // NOSONAR: backoff jitter, not a security use
    }

    /** Resolves after `ms`, or rejects with the abort reason as soon as `signal` aborts. */
    static delay(ms: number, signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(signal.reason);
                return;
            }
            const onAbort = (): void => {
                clearTimeout(timer);
                reject(signal?.reason);
            };
            const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    /**
     * Decides what follows a failed attempt: waits out the provider's
     * Retry-After or the backoff when the error is retryable and attempts
     * remain, otherwise throws.
     */
    static async handleGenerationError(
        error: Error,
        progress: ProgressReporter,
        attempt: number,
        errorHandler: (error: Error) => ApiErrorResult,
        signal?: AbortSignal,
    ): Promise<void> {
        Logger.error(`Generation attempt ${attempt} failed:`, error);
        const { errorMessage, shouldRetry, retryAfterMs } = errorHandler(error);

        if (!shouldRetry || attempt >= MAX_RETRIES) {
            // The cause keeps the HttpError/NetworkError for the telemetry category.
            throw new Error(`Failed to generate commit message: ${errorMessage}`, { cause: error });
        }

        const delayMs = retryAfterMs ?? this.calculateRetryDelay(attempt);
        const seconds = (delayMs / 1000).toFixed(1);
        Logger.log(`Retrying in ${seconds} seconds...`);
        progress.report({
            message: `Waiting ${seconds} seconds before retry...`,
            increment: 0
        });
        await this.delay(delayMs, signal);
    }
}
