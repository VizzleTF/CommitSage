import { describe, it, expect, vi } from 'vitest';
import { RetryUtils } from '../src/utils/retryUtils';
import type { ProgressReporter, ApiErrorResult } from '../src/models/types';

function makeProgress(): ProgressReporter & { calls: unknown[] } {
    const calls: unknown[] = [];
    return {
        calls,
        report: (value: unknown) => { calls.push(value); },
    } as unknown as ProgressReporter & { calls: unknown[] };
}

describe('RetryUtils.updateProgressForAttempt', () => {
    it('reports "Generating" on first attempt', () => {
        const progress = makeProgress();
        RetryUtils.updateProgressForAttempt(progress, 1);
        expect(progress.calls[0]).toEqual({ message: 'Generating commit message...', increment: 10 });
    });

    it('reports a retry message on later attempts', () => {
        const progress = makeProgress();
        RetryUtils.updateProgressForAttempt(progress, 2);
        expect(progress.calls[0]).toEqual({ message: 'Retry attempt 2/3...', increment: 10 });
    });
});

describe('RetryUtils.calculateRetryDelay', () => {
    it('uses exponential backoff', () => {
        expect(RetryUtils.calculateRetryDelay(1)).toBe(1000);
        expect(RetryUtils.calculateRetryDelay(2)).toBe(2000);
        expect(RetryUtils.calculateRetryDelay(3)).toBe(4000);
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
    it('waits out the backoff when shouldRetry and attempts remain', async () => {
        vi.useFakeTimers();
        const progress = makeProgress();
        const errorHandler = (): ApiErrorResult => ({ errorMessage: 'transient', shouldRetry: true });

        let settled = false;
        const promise = RetryUtils.handleGenerationError(new Error('boom'), progress, 1, errorHandler)
            .then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await promise;

        expect(settled).toBe(true);
        // reported a "Waiting ... before retry" message
        expect(progress.calls.some((c) => String((c as { message?: string }).message).includes('before retry'))).toBe(true);
        vi.useRealTimers();
    });

    it('throws when shouldRetry is false', async () => {
        const progress = makeProgress();
        const errorHandler = (): ApiErrorResult => ({ errorMessage: 'fatal', shouldRetry: false });

        const cause = new Error('boom');
        const thrown = RetryUtils.handleGenerationError(cause, progress, 1, errorHandler);
        await expect(thrown).rejects.toThrow('Failed to generate commit message: fatal');
        // Telemetry reads the category from the original error.
        await expect(thrown).rejects.toMatchObject({ cause });
    });

    it('throws when max attempts reached even if shouldRetry', async () => {
        const progress = makeProgress();
        const errorHandler = (): ApiErrorResult => ({ errorMessage: 'still failing', shouldRetry: true });

        await expect(
            RetryUtils.handleGenerationError(new Error('boom'), progress, 3, errorHandler),
        ).rejects.toThrow('Failed to generate commit message: still failing');
    });
});
