/* eslint-disable @typescript-eslint/naming-convention */
import { CommitLintRules } from '../models/types';

/**
 * Per-format validation rule sets for the builtin engine. `rules` uses the
 * commitlint rule model (checked by CommitLintService's validator). Formats
 * whose header isn't conventional-parsable add a `headerPattern`; an optional
 * `stripPrefix` removes the non-conventional lead-in (e.g. the emoji) so the
 * standard rules can check the rest of the header.
 */
export interface FormatRuleSet {
  rules: CommitLintRules;
  headerPattern?: RegExp;
  /** Human description of headerPattern — goes into prompts and error messages. */
  headerHint?: string;
  /** Applied to the header before rule checking (emoji formats). */
  stripPrefix?: RegExp;
  /** Marker for formats validated structurally instead of by header rules. */
  structural?: 'detailed';
}

const BASE_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'];

const CONVENTIONAL_RULES: CommitLintRules = {
  'type-enum':            [2, 'always', [...BASE_TYPES, 'perf', 'revert', 'ci', 'build']],
  'type-case':            [2, 'always', 'lower-case'],
  'type-empty':           [2, 'never'],
  'scope-case':           [2, 'always', 'lower-case'],
  'subject-case':         [2, 'never',  ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
  'subject-empty':        [2, 'never'],
  'subject-full-stop':    [2, 'never',  '.'],
  'header-max-length':    [2, 'always', 72],
  'body-leading-blank':   [1, 'always'],
  'footer-leading-blank': [1, 'always'],
};

// `:emoji:` shortcode or the emoji symbol (with its optional U+FE0F selector).
const EMOJI = String.raw`(:[a-z0-9_+-]+:|\p{Extended_Pictographic}\uFE0F?)`;
const EMOJI_LEAD = new RegExp(`^${EMOJI}\\s+`, 'u');

const KARMA_RULES: CommitLintRules = {
  'type-enum':         [2, 'always', BASE_TYPES],
  'type-case':         [2, 'always', 'lower-case'],
  'type-empty':        [2, 'never'],
  'subject-empty':     [2, 'never'],
  'subject-full-stop': [2, 'never', '.'],
  'header-max-length': [2, 'always', 72],
};

export const FORMAT_RULE_SETS: Record<string, FormatRuleSet> = {
  conventional: { rules: CONVENTIONAL_RULES },

  // No `chore` type and the `!` breaking marker is banned.
  angular: {
    rules: {
      ...CONVENTIONAL_RULES,
      'type-enum':                [2, 'always', ['build', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test']],
      'subject-exclamation-mark': [2, 'never'],
      'footer-leading-blank':     undefined,
    },
  },

  // Same types and casing as conventional; the template only adds a footer.
  atom: { rules: CONVENTIONAL_RULES },

  karma: { rules: KARMA_RULES },

  // `type: message` — a scope is not part of the format.
  semantic: { rules: { ...KARMA_RULES, 'scope-empty': [2, 'always'] } },

  // `type: Description` — conventional types, but the description starts
  // with a capital letter (as in the template's example).
  google: {
    rules: {
      ...CONVENTIONAL_RULES,
      'scope-case':   undefined,
      'subject-case': undefined,
    },
  },

  // `:emoji: message` — no type at all, just the emoji lead-in.
  emoji: {
    rules: {
      'header-max-length': [2, 'always', 72],
    },
    headerPattern: new RegExp(`^${EMOJI}\\s+\\S`, 'u'),
    headerHint: 'header must start with an emoji (shortcode like :sparkles: or the symbol) followed by the message',
    stripPrefix: EMOJI_LEAD,
  },

  // `:emoji: type(scope): message` — karma rules after the emoji lead-in.
  emojiKarma: {
    rules: { ...KARMA_RULES, 'header-max-length': [2, 'always', 80] },
    headerPattern: new RegExp(`^${EMOJI}\\s+[a-z]+(\\([^)]*\\))?: \\S`, 'u'),
    headerHint: 'header must look like ":emoji: type(scope): message"',
    stripPrefix: EMOJI_LEAD,
  },

  // The template lets the model skip Details/Effects, so only the Summary
  // line is required.
  detailed: {
    rules: {},
    structural: 'detailed',
    headerHint: 'message must start with "Summary: …" (≤ 72 chars), optionally followed by "Details:" and "Effects:" sections with "- " bullets',
  },
};
