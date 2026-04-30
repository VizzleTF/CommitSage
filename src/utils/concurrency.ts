/**
 * Run an async mapper over `items` with at most `limit` operations in flight.
 * Preserves output order. If the mapper throws, the rejection propagates and
 * remaining items are still drained but their results are discarded.
 *
 * If `signal` is supplied and aborts mid-run, workers stop pulling new items
 * (in-flight mappers complete or reject on their own) and the call rejects
 * with an `AbortError`-shaped error.
 *
 * Default limit (8) was chosen to keep `git` subprocess fan-out bounded without
 * starving very small changesets — for ≤8 files the behaviour matches Promise.all.
 */
export async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
    signal?: AbortSignal,
): Promise<R[]> {
    if (limit <= 0) {
        throw new Error(`mapLimit: limit must be > 0, got ${limit}`);
    }
    if (items.length === 0) {
        return [];
    }
    if (signal?.aborted) {
        throw new Error('mapLimit aborted');
    }

    const results = new Array<R>(items.length);
    let cursor = 0;

    async function worker(): Promise<void> {
        while (true) {
            if (signal?.aborted) {
                return;
            }
            const i = cursor++;
            if (i >= items.length) {
                return;
            }
            results[i] = await mapper(items[i], i);
        }
    }

    const workerCount = Math.min(limit, items.length);
    const workers: Promise<void>[] = [];
    for (let w = 0; w < workerCount; w++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    if (signal?.aborted) {
        throw new Error('mapLimit aborted');
    }
    return results;
}
