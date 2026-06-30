// Helpers for the commit "refs" feature: extracting a reference (issue/ticket
// ID) from a branch name and inserting it into a generated commit message.

/** Fallback pattern matching Jira/Linear-style IDs (e.g. PROJ-123). */
export const DEFAULT_BRANCH_PATTERN = '[A-Z][A-Z0-9]*-[0-9]+';

/**
 * Extracts a ref from `branchName` using `pattern` (a regex source string).
 *
 * Returns the first capture group when the pattern has one, otherwise the whole
 * match. Returns null when nothing matches. An invalid `pattern` falls back to
 * {@link DEFAULT_BRANCH_PATTERN} so a typo in settings can't break generation.
 */
export function extractRef(branchName: string, pattern: string): string | null {
    if (!branchName) {
        return null;
    }

    let re: RegExp;
    try {
        re = new RegExp(pattern || DEFAULT_BRANCH_PATTERN);
    } catch {
        re = new RegExp(DEFAULT_BRANCH_PATTERN);
    }

    const match = re.exec(branchName);
    if (!match) {
        return null;
    }
    // Prefer the first capture group when present (lets users isolate a number
    // from a prefix, e.g. `issue-(\d+)`); otherwise use the full match.
    return (match[1] ?? match[0]) || null;
}
