import { CommitLintRules } from '../../models/types';
import { isErrorWith } from './ruleShape';

/**
 * Applies mechanical header fixes for rule violations that don't need an LLM
 * round-trip: type/scope casing, trailing full stop, missing blank line before
 * the body. Returns the message unchanged when nothing is fixable.
 */
export function applyAutoFixes(message: string, rules: CommitLintRules): string {
  const lines = message.split('\n');
  let header = lines[0];

  if (isErrorWith(rules, 'type-case', 'always')) {
    const c = rules['type-case'][2];
    if (c === 'lower-case') { header = header.replace(/^[a-zA-Z0-9_-]+/, m => m.toLowerCase()); }
    else if (c === 'upper-case') { header = header.replace(/^[a-zA-Z0-9_-]+/, m => m.toUpperCase()); }
  }

  if (isErrorWith(rules, 'scope-case', 'always')) {
    const c = rules['scope-case'][2];
    if (c === 'lower-case') {
      header = header.replace(/^([a-zA-Z0-9_-]+)\(([^)]*)\)/, (_, t: string, s: string) => `${t}(${s.toLowerCase()})`);
    } else if (c === 'upper-case') {
      header = header.replace(/^([a-zA-Z0-9_-]+)\(([^)]*)\)/, (_, t: string, s: string) => `${t}(${s.toUpperCase()})`);
    }
  }

  if (isErrorWith(rules, 'subject-full-stop', 'never')) {
    const stop = (rules['subject-full-stop'][2] as string) ?? '.';
    while (header.endsWith(stop)) { header = header.slice(0, -stop.length).trimEnd(); }
  }

  lines[0] = header;

  if (isErrorWith(rules, 'body-leading-blank', 'always')
      && lines.length > 1 && lines[1].trim() !== '') {
    lines.splice(1, 0, '');
  }

  return lines.join('\n');
}
