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

    static calculateRetryDelay(attempt: number): number {
        return 1000 * Math.pow(2, attempt - 1);
    }

    static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Decides what follows a failed attempt: waits out the backoff when the
     * error is retryable and attempts remain, otherwise throws.
     */
    static async handleGenerationError(
        error: Error,
        progress: ProgressReporter,
        attempt: number,
        errorHandler: (error: Error) => ApiErrorResult
    ): Promise<void> {
        Logger.error(`Generation attempt ${attempt} failed:`, error);
        const { errorMessage, shouldRetry } = errorHandler(error);

        if (!shouldRetry || attempt >= MAX_RETRIES) {
            throw new Error(`Failed to generate commit message: ${errorMessage}`);
        }

        const delayMs = this.calculateRetryDelay(attempt);
        Logger.log(`Retrying in ${delayMs / 1000} seconds...`);
        progress.report({
            message: `Waiting ${delayMs / 1000} seconds before retry...`,
            increment: 0
        });
        await this.delay(delayMs);
    }
}
