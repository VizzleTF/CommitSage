import { CommitLintRules } from '../../models/types';

/**
 * Helpers over the commitlint rule tuple shape `[level, applicability, value?]`.
 * `level === 2` is commitlint's "error" severity; `applicability` is
 * `'always'` | `'never'`. Centralizes the `rules['x']?.[0] === 2 && ...` check
 * that was repeated ~15× across rule rendering and auto-fixing, so the magic
 * `2` and index access live in one place.
 */
export type RuleApplicability = 'always' | 'never';

/** True when the rule is present at error level (`level === 2`). */
export function isError(rules: CommitLintRules, name: string): boolean {
    return rules[name]?.[0] === 2;
}

/** True when the rule is at error level AND has the given applicability. */
export function isErrorWith(
    rules: CommitLintRules,
    name: string,
    applicability: RuleApplicability,
): boolean {
    return rules[name]?.[0] === 2 && rules[name]?.[1] === applicability;
}
