import { CommitLintRules } from '../../models/types';
import { caseStr } from './caseRules';

export const COMMIT_RULES_DEFAULT = `Conventional Commits format rules:
- <type>: A noun describing the type of change (e.g., feat, fix, docs, style, refactor, test, chore).
- <scope>: An optional noun describing the scope of the change (e.g., component or file name).
- <description>: A brief description of the change.

Commit message structure: <type>(<scope>): <description>

Type priority order (when multiple types present):
- feat > fix > docs > style > refactor > test > chore

Additional requirements:
- ONLY return the commit message in the specified format.
- Do NOT include any additional text, explanations, or formatting.
- Analyze the git diff to determine the most significant change.
- Keep the commit message concise and informative.`;

/** Emits the `${prefix}-max-length` / `${prefix}-min-length` instruction pair. */
function emitLength(rules: CommitLintRules, prefix: string, label: string, lines: string[]): void {
  if (rules[`${prefix}-max-length`]?.[2]) {
    lines.push(`- ${label} max length: ${rules[`${prefix}-max-length`][2]} characters`);
  }
  if (rules[`${prefix}-min-length`]?.[2]) {
    lines.push(`- ${label} min length: ${rules[`${prefix}-min-length`][2]} characters`);
  }
}

function appendTypeInstructions(rules: CommitLintRules, lines: string[]): void {
  if (rules['type-enum']?.[2]?.length) {
    lines.push(`- Allowed types: ${(rules['type-enum'][2] as string[]).join(', ')}`);
  }
  if (rules['type-case']?.[2]) {
    lines.push(`- Type must be ${caseStr(rules['type-case'][2])}`);
  }
  if (rules['type-empty']?.[0] === 2 && rules['type-empty']?.[1] === 'never') {
    lines.push('- Type is required');
  }
  emitLength(rules, 'type', 'Type', lines);
}

function appendScopeInstructions(rules: CommitLintRules, lines: string[]): void {
  if (rules['scope-enum']?.[2]?.length) {
    lines.push(`- Allowed scopes: ${(rules['scope-enum'][2] as string[]).join(', ')}`);
  }
  if (rules['scope-case']?.[2]) {
    lines.push(`- Scope must be ${caseStr(rules['scope-case'][2])}`);
  }
  if (rules['scope-empty']?.[0] === 2) {
    lines.push(rules['scope-empty'][1] === 'never' ? '- Scope is required' : '- Scope must be omitted');
  }
  emitLength(rules, 'scope', 'Scope', lines);
}

function appendSubjectInstructions(rules: CommitLintRules, lines: string[]): void {
  if (rules['subject-case']?.[2]) {
    const verb = rules['subject-case'][1] === 'never' ? 'must NOT be' : 'must be';
    lines.push(`- Subject ${verb}: ${caseStr(rules['subject-case'][2])}`);
  }
  if (rules['subject-empty']?.[0] === 2 && rules['subject-empty']?.[1] === 'never') {
    lines.push('- Subject is required');
  }
  if (rules['subject-full-stop']?.[0] === 2 && rules['subject-full-stop']?.[1] === 'never') {
    lines.push(`- Subject must not end with "${rules['subject-full-stop'][2] ?? '.'}"`);
  }
  emitLength(rules, 'subject', 'Subject', lines);
  if (rules['subject-exclamation-mark']?.[0] === 2) {
    lines.push(rules['subject-exclamation-mark'][1] === 'never'
      ? '- Never put "!" before the ":" in the header'
      : '- Always put "!" before the ":" in the header');
  }
}

function appendHeaderInstructions(rules: CommitLintRules, lines: string[]): void {
  emitLength(rules, 'header', 'Header (first line)', lines);
  if (rules['header-full-stop']?.[0] === 2 && rules['header-full-stop']?.[1] === 'never') {
    lines.push(`- Header must not end with "${rules['header-full-stop'][2] ?? '.'}"`);
  }
}

function appendBodyInstructions(rules: CommitLintRules, lines: string[]): void {
  if (rules['body-leading-blank']?.[0] === 2 && rules['body-leading-blank']?.[1] === 'always') {
    lines.push('- Leave a blank line before the body');
  }
  if (rules['body-max-line-length']?.[2]) {
    lines.push(`- Body max line length: ${rules['body-max-line-length'][2]} characters`);
  }
  if (rules['body-max-length']?.[2]) {
    lines.push(`- Body max length: ${rules['body-max-length'][2]} characters`);
  }
  if (rules['body-empty']?.[0] === 2 && rules['body-empty']?.[1] === 'never') {
    lines.push('- Body is required');
  }
}

function appendFooterInstructions(rules: CommitLintRules, lines: string[]): void {
  if (rules['footer-leading-blank']?.[0] === 2 && rules['footer-leading-blank']?.[1] === 'always') {
    lines.push('- Leave a blank line before the footer');
  }
  if (rules['footer-max-line-length']?.[2]) {
    lines.push(`- Footer max line length: ${rules['footer-max-line-length'][2]} characters`);
  }
  if (rules['footer-max-length']?.[2]) {
    lines.push(`- Footer max length: ${rules['footer-max-length'][2]} characters`);
  }
  if (rules['footer-empty']?.[0] === 2 && rules['footer-empty']?.[1] === 'never') {
    lines.push('- Footer is required');
  }
}

function appendTrailerInstructions(rules: CommitLintRules, lines: string[]): void {
  for (const ruleName of ['signed-off-by', 'trailer-exists'] as const) {
    if (rules[ruleName]?.[0] === 2 && rules[ruleName]?.[1] === 'always') {
      lines.push(`- End the message with a "${rules[ruleName][2] ?? 'Signed-off-by:'}" trailer line`);
    }
  }
}

/** Renders a commitlint rule set into LLM-facing prompt instructions. */
export function rulesToInstructions(rules: CommitLintRules, headerHint?: string): string {
  const lines: string[] = ['Commit message rules for this project:\n'];
  if (headerHint) { lines.push(`- ${headerHint}`); }

  appendTypeInstructions(rules, lines);
  appendScopeInstructions(rules, lines);
  appendSubjectInstructions(rules, lines);
  appendHeaderInstructions(rules, lines);
  appendBodyInstructions(rules, lines);
  appendFooterInstructions(rules, lines);
  appendTrailerInstructions(rules, lines);

  return lines.length > 1 ? lines.join('\n') : COMMIT_RULES_DEFAULT;
}
