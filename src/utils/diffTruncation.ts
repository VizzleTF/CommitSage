// "Gentle" diff truncation for fitting a large combined diff into the prompt
// budget while preserving as much meaning as possible.
//
// The naive approach — `diff.slice(0, max)` — chops mid-line (breaking the last
// hunk) and is front-biased: later files (and whole categories like untracked /
// deleted, which are concatenated last) vanish silently, so the model never
// learns they changed. This module instead:
//   - splits the diff into per-file blocks on `diff --git` boundaries,
//   - keeps every file's header (the model sees ALL changed paths),
//   - budgets fairly — small files survive whole, the remainder is shared among
//     the large ones — so one giant file (lockfile, generated code) can't starve
//     the rest,
//   - cuts each block at a line boundary, never mid-line, with an explicit
//     per-file marker.

const FILE_TRUNCATED_MARKER = '\n…(file diff truncated)\n';
const DIFF_TRUNCATED_MARKER = '\n…(diff truncated)';

/** Largest prefix of `s` that ends on a line boundary and is ≤ `limit`. */
function sliceAtLineBoundary(s: string, limit: number): string {
    if (s.length <= limit) {
        return s;
    }
    const lastNewline = s.lastIndexOf('\n', limit);
    // No newline within the budget → keep the hard prefix (a single line longer
    // than the budget; rare, e.g. a minified file on one line).
    return s.slice(0, lastNewline > 0 ? lastNewline : limit);
}

/**
 * Split a combined git diff into per-file blocks. Each block starts at a
 * `diff --git ` line; any leading text before the first one (e.g. a
 * `# Staged changes:` category header) is attached to the first block.
 * Returns the whole diff as a single block when no headers are found
 * (e.g. a lone `git diff --no-index` for one untracked file).
 */
export function splitIntoFileBlocks(diff: string): string[] {
    const marker = 'diff --git ';
    const starts: number[] = [];
    if (diff.startsWith(marker)) {
        starts.push(0);
    }
    for (let idx = diff.indexOf('\n' + marker); idx !== -1; idx = diff.indexOf('\n' + marker, idx + 1)) {
        starts.push(idx + 1);
    }
    if (starts.length === 0) {
        return [diff];
    }
    const blocks: string[] = [];
    for (let i = 0; i < starts.length; i++) {
        const end = i + 1 < starts.length ? starts[i + 1] : diff.length;
        blocks.push(diff.slice(starts[i], end));
    }
    // Attach any preamble (a category header before the first file) to block 0.
    if (starts[0] > 0) {
        blocks[0] = diff.slice(0, starts[0]) + blocks[0];
    }
    return blocks;
}

/**
 * Truncate `diff` to roughly `maxLength` characters, preserving every changed
 * file's header and sharing the budget fairly across files. Returns the diff
 * unchanged when it already fits (and when `maxLength` is non-finite, i.e. the
 * "no limit" setting).
 */
export function truncateDiff(diff: string, maxLength: number): string {
    if (diff.length <= maxLength) {
        return diff;
    }

    const blocks = splitIntoFileBlocks(diff);

    // Single block (one giant file, or an unrecognized shape): line-boundary cut.
    if (blocks.length <= 1) {
        return sliceAtLineBoundary(diff, maxLength) + DIFF_TRUNCATED_MARKER;
    }

    // Fair allocation: small blocks (≤ equal share) are kept whole; the
    // remaining budget is split evenly across the large blocks. Each large
    // block is then cut at a line boundary, leaving room for its marker, so its
    // `diff --git` header (the first line) always survives.
    const equalShare = Math.floor(maxLength / blocks.length);
    const smallTotal = blocks
        .filter(b => b.length <= equalShare)
        .reduce((sum, b) => sum + b.length, 0);
    const largeCount = blocks.filter(b => b.length > equalShare).length;
    const largeShare = largeCount > 0
        ? Math.max(0, Math.floor((maxLength - smallTotal) / largeCount))
        : 0;

    return blocks
        .map(block => {
            if (block.length <= equalShare) {
                return block;
            }
            const body = sliceAtLineBoundary(block, Math.max(0, largeShare - FILE_TRUNCATED_MARKER.length));
            return body + FILE_TRUNCATED_MARKER;
        })
        .join('');
}
