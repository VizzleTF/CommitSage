import { ParsedCommit } from '../../models/types';

/** Parsed commit parts plus the raw split lines, passed to per-category rule checkers. */
export interface RuleContext extends ParsedCommit {
  msgLines: string[];
}

export function isTrailerLine(line: string): boolean {
  return /^(?:BREAKING[ -]CHANGE: |[A-Za-z][A-Za-z0-9-]*(?:: | #))/.test(line);
}

/**
 * Splits a commit message into header / body / footer and parses the header
 * into type / scope / subject. Body and footer are separated by the standard
 * "trailing block of trailer lines after the last blank line" heuristic.
 */
export function parseCommitMessage(message: string): ParsedCommit {
  const lines = message.split('\n');
  const header = lines[0] ?? '';

  // Collect indices of blank lines (skip line 0 which is the header)
  const blankIndices: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') { blankIndices.push(i); }
  }

  let bodyLines: string[] = [];
  let footerLines: string[] = [];

  if (blankIndices.length > 0) {
    const firstBlank = blankIndices[0];

    let footerBlankIdx = -1;
    for (let b = blankIndices.length - 1; b >= 0; b--) {
      const sectionStart = blankIndices[b] + 1;
      const sectionLines = lines.slice(sectionStart).filter(l => l.trim() !== '');
      if (sectionLines.length > 0 && sectionLines.every(l => isTrailerLine(l))) {
        footerBlankIdx = blankIndices[b];
      } else {
        break;
      }
    }

    if (footerBlankIdx > firstBlank) {
      bodyLines  = lines.slice(firstBlank + 1, footerBlankIdx);
      footerLines = lines.slice(footerBlankIdx + 1);
    } else if (footerBlankIdx === firstBlank) {
      footerLines = lines.slice(firstBlank + 1);
    } else {
      bodyLines = lines.slice(firstBlank + 1);
    }
  }

  const body   = bodyLines.join('\n').trim();
  const footer = footerLines.join('\n').trim();

  const headerMatch = /^([a-zA-Z0-9_-]{1,50})(?:\(([^)]{0,100})\))?!?:\s{0,16}(.*)$/.exec(header);

  return {
    header,
    type:    headerMatch?.[1] ?? '',
    scope:   headerMatch?.[2] ?? null,
    subject: headerMatch?.[3] ?? header,
    body,
    footer,
  };
}
