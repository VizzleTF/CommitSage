import { CommitLintRules } from '../../models/types';

/**
 * Applies mechanical header fixes for rule violations that don't need an LLM
 * round-trip: type/scope casing, trailing full stop, missing blank line before
 * the body. Returns the message unchanged when nothing is fixable.
 */
export function applyAutoFixes(message: string, rules: CommitLintRules): string {
  const lines = message.split('\n');
  let header = lines[0] ?? '';

  if (rules['type-case']?.[0] === 2 && rules['type-case']?.[1] === 'always') {
    const c = rules['type-case'][2];
    if (c === 'lower-case') { header = header.replace(/^[a-zA-Z0-9_-]+/, m => m.toLowerCase()); }
    else if (c === 'upper-case') { header = header.replace(/^[a-zA-Z0-9_-]+/, m => m.toUpperCase()); }
  }

  if (rules['scope-case']?.[0] === 2 && rules['scope-case']?.[1] === 'always') {
    const c = rules['scope-case'][2];
    if (c === 'lower-case') {
      header = header.replace(/^([a-zA-Z0-9_-]+)\(([^)]*)\)/, (_, t: string, s: string) => `${t}(${s.toLowerCase()})`);
    }
  }

  if (rules['subject-full-stop']?.[0] === 2 && rules['subject-full-stop']?.[1] === 'never') {
    const stop = (rules['subject-full-stop'][2] as string) ?? '.';
    while (header.endsWith(stop)) { header = header.slice(0, -stop.length).trimEnd(); }
  }

  lines[0] = header;

  if (rules['body-leading-blank']?.[0] === 2 && rules['body-leading-blank']?.[1] === 'always'
      && lines.length > 1 && lines[1].trim() !== '') {
    lines.splice(1, 0, '');
  }

  return lines.join('\n');
}
