import { describe, it, expect, vi } from 'vitest';
import { RetryUtils } from '../src/utils/retryUtils';
import type { ProgressReporter, CommitMessage, ApiErrorResult } from '../src/models/types';

function makeProgress(): ProgressReporter & { calls: unknown[] } {
    const calls: unknown[] = [];
    return {
        calls,
        report: (value: unknown) => { calls.push(value); },
    } as unknown as ProgressReporter & { calls: unknown[] };
}

describe('RetryUtils.updateProgressForAttempt', () => {
    it('reports "Generating" on first attempt', async () => {
        const progress = makeProgress();
        await RetryUtils.updateProgressForAttempt(progress, 1);
        expect(progress.calls[0]).toEqual({ message: 'Generating commit message...', increment: 10 });
    });

    it('reports a retry message on later attempts', async () => {
        const progress = makeProgress();
        await RetryUtils.updateProgressForAttempt(progress, 2);
        expect(progress.calls[0]).toEqual({ message: 'Retry attempt 2/3...', increment: 10 });
    });
});

describe('RetryUtils.calculateRetryDelay', () => {
    it('uses exponential backoff', () => {
        expect(RetryUtils.calculateRetryDelay(1)).toBe(1000);
        expect(RetryUtils.calculateRetryDelay(2)).toBe(2000);
        expect(RetryUtils.calculateRetryDelay(3)).toBe(4000);
    });

    it('caps at the default max backoff', () => {
        expect(RetryUtils.calculateRetryDelay(100)).toBe(RetryUtils.DEFAULT_MAX_RETRY_BACKOFF);
    });

    it('honours an explicit max backoff', () => {
        expect(RetryUtils.calculateRetryDelay(100, 500)).toBe(500);
    });
});

describe('RetryUtils.delay', () => {
    it('resolves after the timer fires', async () => {
        vi.useFakeTimers();
        const p = RetryUtils.delay(1000);
        vi.advanceTimersByTime(1000);
        await p;
        vi.useRealTimers();
    });
});

describe('RetryUtils.handleGenerationError', () => {
    it('retries when shouldRetry and attempts remain', async () => {
        vi.useFakeTimers();
        const progress = makeProgress();
        const generated: CommitMessage = { content: 'ok', model: 'm' } as unknown as CommitMessage;
        const generateFn = vi.fn(async () => generated);
        const errorHandler = (): ApiErrorResult => ({ errorMessage: 'transient', shouldRetry: true });

        const promise = RetryUtils.handleGenerationError(
            new Error('boom'),
            'prompt',
            progress,
            1,
            generateFn,
            errorHandler,
        );
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toBe(generated);
        expect(generateFn).toHaveBeenCalledWith('prompt', progress, 2);
        // reported a "Waiting ... before retry" message
        expect(progress.calls.some((c) => String((c as { message?: string }).message).includes('before retry'))).toBe(true);
        vi.useRealTimers();
    });

    it('throws when shouldRetry is false', async () => {
        const progress = makeProgress();
        const generateFn = vi.fn(async () => ({} as CommitMessage));
        const errorHandler = (): ApiErrorResult => ({ errorMessage: 'fatal', shouldRetry: false });

        await expect(
            RetryUtils.handleGenerationError(new Error('boom'), 'p', progress, 1, generateFn, errorHandler),
        ).rejects.toThrow('Failed to generate commit message: fatal');
        expect(generateFn).not.toHaveBeenCalled();
    });

    it('throws when max attempts reached even if shouldRetry', async () => {
        const progress = makeProgress();
        const generateFn = vi.fn(async () => ({} as CommitMessage));
        const errorHandler = (): ApiErrorResult => ({ errorMessage: 'still failing', shouldRetry: true });

        await expect(
            RetryUtils.handleGenerationError(new Error('boom'), 'p', progress, 3, generateFn, errorHandler),
        ).rejects.toThrow('Failed to generate commit message: still failing');
        expect(generateFn).not.toHaveBeenCalled();
    });
});
