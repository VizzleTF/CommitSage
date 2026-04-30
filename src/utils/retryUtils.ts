import { Logger } from './logger';
import { CommitMessage, ProgressReporter, ApiErrorResult } from '../models/types';

const MAX_RETRIES = 3;

export class RetryUtils {
    static readonly DEFAULT_MAX_RETRY_BACKOFF = 10000;

    static async updateProgressForAttempt(
        progress: ProgressReporter,
        attempt: number
    ): Promise<void> {
        const progressMessage = attempt === 1
            ? 'Generating commit message...'
            : `Retry attempt ${attempt}/${MAX_RETRIES}...`;
        progress.report({ message: progressMessage, increment: 10 });
    }

    static calculateRetryDelay(attempt: number, maxBackoff?: number): number {
        const backoff = maxBackoff || this.DEFAULT_MAX_RETRY_BACKOFF;
        return Math.min(1000 * Math.pow(2, attempt - 1), backoff);
    }

    static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async handleGenerationError(
        error: Error,
        prompt: string,
        progress: ProgressReporter,
        attempt: number,
        generateFn: (prompt: string, progress: ProgressReporter, attempt: number) => Promise<CommitMessage>,
        errorHandler: (error: Error) => ApiErrorResult
    ): Promise<CommitMessage> {
        Logger.error(`Generation attempt ${attempt} failed:`, error);
        const { errorMessage, shouldRetry } = errorHandler(error);

        if (shouldRetry && attempt < MAX_RETRIES) {
            const delayMs = this.calculateRetryDelay(attempt);
            Logger.log(`Retrying in ${delayMs / 1000} seconds...`);
            progress.report({
                message: `Waiting ${delayMs / 1000} seconds before retry...`,
                increment: 0
            });
            await this.delay(delayMs);

            return generateFn(prompt, progress, attempt + 1);
        }

        throw new Error(`Failed to generate commit message: ${errorMessage}`);
    }
}