import { describe, it, expect } from 'vitest';
import { mapLimit } from '../src/utils/concurrency';

describe('mapLimit', () => {
    it('returns [] for empty input', async () => {
        const result = await mapLimit([], 4, async () => 1);
        expect(result).toEqual([]);
    });

    it('preserves output order even with variable timing', async () => {
        const items = [50, 10, 30, 5, 20];
        const out = await mapLimit(items, 3, async (n) => {
            await new Promise((r) => setTimeout(r, n));
            return n * 2;
        });
        expect(out).toEqual([100, 20, 60, 10, 40]);
    });

    it('caps in-flight operations to limit', async () => {
        let inFlight = 0;
        let peak = 0;
        const items = Array.from({ length: 20 }, (_, i) => i);
        await mapLimit(items, 4, async (n) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return n;
        });
        expect(peak).toBeLessThanOrEqual(4);
    });

    it('rejects on a 0 limit', async () => {
        await expect(mapLimit([1], 0, async (x) => x)).rejects.toThrow();
    });

    it('uses min(limit, items.length) workers', async () => {
        let started = 0;
        const items = [1, 2];
        await mapLimit(items, 100, async (n) => {
            started++;
            return n;
        });
        expect(started).toBe(2);
    });
});
