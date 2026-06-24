/* eslint-disable @typescript-eslint/naming-convention */
// Case-style helpers shared by the validator (does a field match a case?) and
// the prompt-instruction generator (how do we name a case to the LLM?).

const CASE_LABELS: Record<string, string> = {
  'lower-case':    'lowercase',
  'upper-case':    'UPPERCASE',
  'camel-case':    'camelCase',
  'pascal-case':   'PascalCase',
  'snake-case':    'snake_case',
  'kebab-case':    'kebab-case',
  'sentence-case': 'Sentence case',
  'start-case':    'Start Case',
};

/** Human label(s) for a commitlint case value (string or array of strings). */
export function caseStr(v: unknown): string {
  if (Array.isArray(v)) { return v.map(c => CASE_LABELS[c as string] ?? String(c)).join(', '); }
  return CASE_LABELS[v as string] ?? String(v);
}

/** True when `value` satisfies the case rule under the given condition. */
export function checkCase(value: string, caseRule: unknown, condition: 'always' | 'never'): boolean {
  const cases = Array.isArray(caseRule) ? caseRule as string[] : [caseRule as string];
  const matches = (c: string): boolean => {
    switch (c) {
      case 'lower-case':    return value === value.toLowerCase();
      case 'upper-case':    return value === value.toUpperCase();
      case 'camel-case':    return /^[a-z][a-zA-Z0-9]*$/.test(value);
      case 'pascal-case':   return /^[A-Z][a-zA-Z0-9]*$/.test(value);
      case 'snake-case':    return /^[a-z][a-z0-9_]*$/.test(value);
      case 'kebab-case':    return /^[a-z][a-z0-9-]*$/.test(value);
      case 'sentence-case': return /^[A-Z]/.test(value);
      case 'start-case':    return value.split(' ').every(w => /^[A-Z]/.test(w));
      default:              return false;
    }
  };
  return condition === 'always' ? cases.some(matches) : !cases.some(matches);
}
