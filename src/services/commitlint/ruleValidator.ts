import { CommitLintRules, CommitLintResult } from '../../models/types';
import { FormatRuleSet } from '../formatRules';
import { caseStr, checkCase } from './caseRules';
import { RuleContext, parseCommitMessage } from './commitParser';

const isEmpty = (s: string): boolean => s.trim() === '';

/** Validates a message against a builtin format rule set (header pattern + rules). */
export function validateWithRuleSet(message: string, ruleSet: FormatRuleSet): CommitLintResult {
  if (ruleSet.structural === 'detailed') { return validateDetailed(message); }

  const lines = message.split('\n');
  const header = lines[0] ?? '';

  if (ruleSet.headerPattern && !ruleSet.headerPattern.test(header)) {
    return { valid: false, errors: [ruleSet.headerHint ?? 'header does not match the required format'] };
  }

  // Strip the non-conventional lead-in (emoji) so standard rules can run.
  const checked = ruleSet.stripPrefix
    ? [header.replace(ruleSet.stripPrefix, ''), ...lines.slice(1)].join('\n')
    : message;
  return validateCommit(checked, ruleSet.rules);
}

function validateDetailed(message: string): CommitLintResult {
  const errors: string[] = [];
  const lines = message.split('\n');
  const header = lines[0] ?? '';

  if (!/^Summary: \S/.test(header)) {
    errors.push('first line must be "Summary: <imperative summary>"');
  } else if (header.length > 'Summary: '.length + 72) {
    errors.push('summary must not be longer than 72 characters');
  }
  if (!lines.some(l => l.trim() === 'Details:')) {
    errors.push('message must contain a "Details:" section');
  }
  if (!lines.some(l => l.trim() === 'Effects:')) {
    errors.push('message must contain an "Effects:" section');
  }
  return { valid: errors.length === 0, errors };
}

export function validateCommit(message: string, rules: CommitLintRules): CommitLintResult {
  const errors: string[] = [];
  const parsed = parseCommitMessage(message);
  const ctx: RuleContext = { ...parsed, msgLines: message.split('\n') };

  for (const [ruleName, entry] of Object.entries(rules)) {
    if (entry?.[0] !== 2) { continue; }
    const condition = entry[1] as 'always' | 'never';
    const value     = entry[2];

    const error = evaluateRule(ruleName, condition, value, ctx);
    if (error) { errors.push(error); }
  }

  return { valid: errors.length === 0, errors };
}

/** Dispatches a single rule to its category handler. Returns an error message or null. */
function evaluateRule(
  ruleName: string,
  condition: 'always' | 'never',
  value: unknown,
  ctx: RuleContext,
): string | null {
  const category = ruleName === 'signed-off-by' || ruleName === 'trailer-exists'
    ? 'trailer'
    : ruleName.split('-')[0];
  switch (category) {
    case 'type':    return checkTypeRule(ruleName, condition, value, ctx);
    case 'scope':   return checkScopeRule(ruleName, condition, value, ctx);
    case 'subject': return checkSubjectRule(ruleName, condition, value, ctx);
    case 'header':  return checkHeaderRule(ruleName, condition, value, ctx);
    case 'body':    return checkBodyRule(ruleName, condition, value, ctx);
    case 'footer':  return checkFooterRule(ruleName, condition, value, ctx);
    case 'trailer': return checkTrailerRule(condition, value, ctx);
    default:        return null;
  }
}

// Shared, field-agnostic rule primitives. Each preserves the exact message
// and branch semantics the per-category switches used inline; `label` names
// the field (type/scope/subject/...) in the message.

function checkCaseRule(
  field: string, label: string, value: unknown, condition: 'always' | 'never',
): string | null {
  if (!field || checkCase(field, value, condition)) { return null; }
  const negation = condition === 'always' ? '' : 'not ';
  return `${label} must be ${negation}${caseStr(value)}`;
}

function checkEmptyRule(
  field: string | null, label: string, condition: 'always' | 'never', handleAlways: boolean,
): string | null {
  const empty = field === null || isEmpty(field);
  if (condition === 'never' && empty) { return `${label} may not be empty`; }
  if (handleAlways && condition === 'always' && !empty) { return `${label} must be empty`; }
  return null;
}

function checkFullStopRule(
  field: string, label: string, value: unknown, condition: 'always' | 'never', skipEmpty: boolean,
): string | null {
  if (skipEmpty && !field) { return null; }
  const stop = (value as string) ?? '.';
  if (condition === 'never' && field.endsWith(stop)) { return `${label} may not end with "${stop}"`; }
  if (condition === 'always' && !field.endsWith(stop)) { return `${label} must end with "${stop}"`; }
  return null;
}

function checkLengthRule(
  field: string | null, label: string, ruleName: string, value: unknown, skipEmpty: boolean,
): string | null {
  if (field === null || (skipEmpty && field === '')) { return null; }
  if (ruleName.endsWith('-max-length') && field.length > (value as number)) {
    return `${label} must not be longer than ${value} characters`;
  }
  if (ruleName.endsWith('-min-length') && field.length < (value as number)) {
    return `${label} must not be shorter than ${value} characters`;
  }
  return null;
}

function checkTypeRule(
  ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
): string | null {
  const { type } = ctx;
  switch (ruleName) {
    case 'type-enum': {
      const list = value as string[];
      if (type && (condition === 'never' ? list.includes(type) : !list.includes(type))) {
        return `type must ${condition === 'never' ? 'not ' : ''}be one of [${list.join(', ')}]`;
      }
      return null;
    }
    case 'type-case':       return checkCaseRule(type, 'type', value, condition);
    case 'type-empty':      return checkEmptyRule(type, 'type', condition, true);
    case 'type-max-length':
    case 'type-min-length': return checkLengthRule(type, 'type', ruleName, value, false);
    default:                return null;
  }
}

function checkScopeRule(
  ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
): string | null {
  const { scope } = ctx;
  switch (ruleName) {
    case 'scope-enum': {
      const list = value as string[];
      if (scope === null || scope === '') { return null; }
      // commitlint allows multiple scopes delimited by "/", "\" or ","
      const scopes = scope.split(/[/,\\]/).map(s => s.trim()).filter(Boolean);
      const violates = condition === 'never'
        ? scopes.some(s => list.includes(s))
        : !scopes.every(s => list.includes(s));
      if (!violates) { return null; }
      return `scope must ${condition === 'never' ? 'not ' : ''}be one of [${list.join(', ')}]`;
    }
    case 'scope-case':      return checkCaseRule(scope ?? '', 'scope', value, condition);
    case 'scope-empty':     return checkEmptyRule(scope, 'scope', condition, true);
    case 'scope-max-length':
    case 'scope-min-length': return checkLengthRule(scope, 'scope', ruleName, value, true);
    default:
      return null;
  }
}

function checkSubjectRule(
  ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
): string | null {
  const { subject, header } = ctx;
  switch (ruleName) {
    case 'subject-case':       return checkCaseRule(subject, 'subject', value, condition);
    case 'subject-empty':      return checkEmptyRule(subject, 'subject', condition, false);
    case 'subject-full-stop':  return checkFullStopRule(subject, 'subject', value, condition, false);
    case 'subject-max-length':
    case 'subject-min-length': return checkLengthRule(subject, 'subject', ruleName, value, false);
    case 'subject-exclamation-mark': {
      const hasMark = /^[a-zA-Z0-9_-]+(?:\([^)]*\))?!:/.test(header);
      if (condition === 'never' && hasMark) { return 'subject must not have an exclamation mark before the ":" marker'; }
      if (condition === 'always' && !hasMark) { return 'subject must have an exclamation mark before the ":" marker'; }
      return null;
    }
    default:
      return null;
  }
}

function checkHeaderRule(
  ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
): string | null {
  const { header } = ctx;
  switch (ruleName) {
    case 'header-max-length':
    case 'header-min-length': return checkLengthRule(header, 'header', ruleName, value, false);
    case 'header-case':       return checkCaseRule(header, 'header', value, condition);
    case 'header-full-stop':  return checkFullStopRule(header, 'header', value, condition, false);
    case 'header-trim':
      return header === header.trim() ? null : 'header must not have leading or trailing whitespace';
    default:
      return null;
  }
}

function checkBodyRule(
  ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
): string | null {
  const { body, msgLines } = ctx;
  switch (ruleName) {
    case 'body-leading-blank':
      if (condition === 'always' && msgLines.length > 1 && msgLines[1].trim() !== '') {
        return 'body must have a leading blank line';
      }
      return null;
    case 'body-max-line-length':
      return body.split('\n').some(l => l.length > (value as number))
        ? `body line must not be longer than ${value} characters` : null;
    case 'body-max-length':
    case 'body-min-length': return checkLengthRule(body, 'body', ruleName, value, false);
    case 'body-empty':      return checkEmptyRule(body, 'body', condition, false);
    case 'body-case':       return checkCaseRule(body, 'body', value, condition);
    case 'body-full-stop':  return checkFullStopRule(body, 'body', value, condition, true);
    default:
      return null;
  }
}

function checkFooterRule(
  ruleName: string, condition: 'always' | 'never', value: unknown, ctx: RuleContext,
): string | null {
  const { footer, msgLines } = ctx;
  switch (ruleName) {
    case 'footer-leading-blank': {
      if (condition === 'always' && footer) {
        const firstFooterLine = footer.split('\n')[0];
        const idx = msgLines.indexOf(firstFooterLine);
        if (idx > 0 && msgLines[idx - 1] !== '') {
          return 'footer must have a leading blank line';
        }
      }
      return null;
    }
    case 'footer-max-line-length':
      return footer.split('\n').some(l => l.length > (value as number))
        ? `footer line must not be longer than ${value} characters` : null;
    case 'footer-max-length':
    case 'footer-min-length': return checkLengthRule(footer, 'footer', ruleName, value, false);
    case 'footer-empty':      return checkEmptyRule(footer, 'footer', condition, false);
    default:
      return null;
  }
}

function checkTrailerRule(
  condition: 'always' | 'never', value: unknown, ctx: RuleContext,
): string | null {
  const trailer = (value as string) ?? 'Signed-off-by:';
  const present = ctx.msgLines.some(l => l.startsWith(trailer));
  if (condition === 'always' && !present) { return `message must contain a "${trailer}" trailer`; }
  if (condition === 'never' && present) { return `message must not contain a "${trailer}" trailer`; }
  return null;
}
