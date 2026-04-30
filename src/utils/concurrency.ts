/**
 * Run an async mapper over `items` with at most `limit` operations in flight.
 * Preserves output order. If the mapper throws, the rejection propagates and
 * remaining items are still drained but their results are discarded.
 *
 * Default limit (8) was chosen to keep `git` subprocess fan-out bounded without
 * starving very small changesets — for ≤8 files the behaviour matches Promise.all.
 */
export async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (limit <= 0) {
        throw new Error(`mapLimit: limit must be > 0, got ${limit}`);
    }
    if (items.length === 0) {
        return [];
    }

    const results = new Array<R>(items.length);
    let cursor = 0;

    async function worker(): Promise<void> {
        while (true) {
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
    return results;
}
