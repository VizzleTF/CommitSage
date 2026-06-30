// Single source of truth for the rules the `custom` commit format implies.
// Browser-safe (no `vscode`/Node imports) so both the webview frontend and the
// extension host can import it. Previously this invariant was hand-encoded in
// three places (the host config listener, the format <select> onChange, and the
// commitlint section render) that drifted independently.

/**
 * `custom` format means "use the user's customInstructions verbatim", so the
 * `useCustomInstructions` gate must track it.
 */
export function formatUsesCustomInstructions(format: string): boolean {
    return format === 'custom';
}

/**
 * Structured commitlint validation can't apply to a free-form custom prompt, so
 * commitlint is unavailable (and forced off) for the `custom` format.
 */
export function formatSupportsCommitlint(format: string): boolean {
    return format !== 'custom';
}
