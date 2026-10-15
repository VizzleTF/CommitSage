import { describe, it, expect, vi, afterEach } from 'vitest';
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

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('RetryUtils.calculateRetryDelay', () => {
    it('uses exponential backoff', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(RetryUtils.calculateRetryDelay(1)).toBe(1000);
        expect(RetryUtils.calculateRetryDelay(2)).toBe(2000);
        expect(RetryUtils.calculateRetryDelay(3)).toBe(4000);
    });

    it('spreads each step by half either way', () => {
        vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999);
        expect(RetryUtils.calculateRetryDelay(2)).toBe(1000);
        expect(RetryUtils.calculateRetryDelay(2)).toBeCloseTo(2998);
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

    it('rejects as soon as the signal aborts', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const p = RetryUtils.delay(10_000, controller.signal);
        controller.abort();
        await expect(p).rejects.toMatchObject({ name: 'AbortError' });
        await expect(RetryUtils.delay(10, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('RetryUtils.handleGenerationError', () => {
    it('waits out the backoff when shouldRetry and attempts remain', async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
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

    it('waits the Retry-After of the provider instead of the backoff', async () => {
        vi.useFakeTimers();
        const errorHandler = (): ApiErrorResult => ({ errorMessage: 'slow down', shouldRetry: true, retryAfterMs: 3000 });

        let settled = false;
        const promise = RetryUtils.handleGenerationError(new Error('boom'), makeProgress(), 1, errorHandler)
            .then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(2999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await promise;
        expect(settled).toBe(true);
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
