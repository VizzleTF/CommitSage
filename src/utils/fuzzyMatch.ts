/**
 * Three-tier fuzzy match scorer for the model combobox (and any other
 * type-to-filter list). Pure + DOM-free so it can be unit-tested directly.
 *
 * Tier 1 — `query` is a contiguous substring of `target` (case-insensitive).
 *   Best score. Earlier match position wins (`claude-3-5-sonnet` ranks above
 *   `meta/some-claude-fork` for query `claude`).
 * Tier 2 — `query` chars appear as a subsequence in `target`, preserving
 *   order, possibly with gaps. Example: `clu` → `c…l…u` matches `claude`.
 *   Earlier first-match position wins.
 * Tier 3 — `target` contains every char of `query` as a multiset, in any
 *   order. Example: `gml` → `glm` (no order match, but all three chars
 *   present). Lowest priority.
 *
 * Returns `null` when none of the tiers match — the item is filtered out.
 */
export function fuzzyScore(query: string, target: string): number | null {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    if (!q) {
        return 0;
    }

    // Tier 1: contiguous substring.
    const sub = t.indexOf(q);
    if (sub >= 0) {
        return 1_000_000 - sub;
    }

    // Tier 2: subsequence preserving order. Iterate over code points (not
    // UTF-16 code units) so surrogate pairs (emoji) compare correctly.
    const tChars = [...t];
    const qChars = [...q];
    let qi = 0;
    let firstMatch = -1;
    for (let i = 0; i < tChars.length && qi < qChars.length; i++) {
        if (tChars[i] === qChars[qi]) {
            if (firstMatch < 0) {
                firstMatch = i;
            }
            qi++;
        }
    }
    if (qi === qChars.length) {
        return 100_000 - firstMatch;
    }

    // Tier 3: target contains every char of query as a multiset (order ignored).
    // Use a counts map so `gg` doesn't match a target with a single `g`.
    const tCounts = new Map<string, number>();
    for (const ch of t) {
        tCounts.set(ch, (tCounts.get(ch) ?? 0) + 1);
    }
    for (const ch of q) {
        const c = tCounts.get(ch) ?? 0;
        if (c === 0) {
            return null;
        }
        tCounts.set(ch, c - 1);
    }
    // Shorter targets rank higher within tier 3 — `glm` beats
    // `something/with/glm-tagged-name-longer` when the query is `gml`.
    return 10_000 - t.length;
}
