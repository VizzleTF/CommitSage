import { describe, it, expect } from 'vitest';
import { mapLimit } from '../src/utils/concurrency';

describe('mapLimit signal handling', () => {
    it('throws immediately if signal already aborted before start', async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(mapLimit([1, 2, 3], 2, async (x) => x, ac.signal)).rejects.toThrow('mapLimit aborted');
    });

    it('stops pulling new items and rejects when aborted mid-run', async () => {
        const ac = new AbortController();
        const items = [1, 2, 3, 4, 5, 6];
        const processed: number[] = [];

        const promise = mapLimit(
            items,
            1,
            async (x) => {
                processed.push(x);
                if (x === 2) {
                    ac.abort();
                }
                await new Promise((r) => setTimeout(r, 1));
                return x;
            },
            ac.signal,
        );

        await expect(promise).rejects.toThrow('mapLimit aborted');
        // Worker stopped pulling new items after the abort (line 35 return path).
        expect(processed.length).toBeLessThan(items.length);
    });
});
