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

const EMOJI_LEAD = /^(:[a-z0-9_+-]+:|\p{Extended_Pictographic}️?)\s+/u;

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

  atom: {
    rules: {
      ...CONVENTIONAL_RULES,
      'type-enum': [2, 'always', BASE_TYPES],
    },
  },

  karma: {
    rules: {
      'type-enum':         [2, 'always', BASE_TYPES],
      'type-case':         [2, 'always', 'lower-case'],
      'type-empty':        [2, 'never'],
      'subject-empty':     [2, 'never'],
      'subject-full-stop': [2, 'never', '.'],
      'header-max-length': [2, 'always', 72],
    },
  },

  // `type: message` — a scope is not part of the format.
  semantic: {
    rules: {
      'type-enum':         [2, 'always', BASE_TYPES],
      'type-case':         [2, 'always', 'lower-case'],
      'type-empty':        [2, 'never'],
      'scope-empty':       [2, 'always'],
      'subject-empty':     [2, 'never'],
      'subject-full-stop': [2, 'never', '.'],
      'header-max-length': [2, 'always', 72],
    },
  },

  // `<Type>: <Description>` — capitalized type, otherwise conventional-like.
  google: {
    rules: {
      'type-enum':         [2, 'always', ['Feat', 'Fix', 'Docs', 'Style', 'Refactor', 'Test', 'Chore']],
      'type-empty':        [2, 'never'],
      'subject-empty':     [2, 'never'],
      'header-max-length': [2, 'always', 72],
    },
    headerPattern: /^[A-Z][a-zA-Z]*(\([^)]*\))?: \S/,
    headerHint: 'header must look like "Type: Description" with a capitalized type',
  },

  // `:emoji: message` — no type at all, just the emoji lead-in.
  emoji: {
    rules: {
      'header-max-length': [2, 'always', 72],
    },
    headerPattern: /^(:[a-z0-9_+-]+:|\p{Extended_Pictographic}️?)\s+\S/u,
    headerHint: 'header must start with an emoji (shortcode like :sparkles: or the symbol) followed by the message',
    stripPrefix: EMOJI_LEAD,
  },

  // `:emoji: type(scope): message` — karma rules after the emoji lead-in.
  emojiKarma: {
    rules: {
      'type-enum':         [2, 'always', BASE_TYPES],
      'type-case':         [2, 'always', 'lower-case'],
      'type-empty':        [2, 'never'],
      'subject-empty':     [2, 'never'],
      'subject-full-stop': [2, 'never', '.'],
      'header-max-length': [2, 'always', 80],
    },
    headerPattern: /^(:[a-z0-9_+-]+:|\p{Extended_Pictographic}️?)\s+[a-z]+(\([^)]*\))?: \S/u,
    headerHint: 'header must look like ":emoji: type(scope): message"',
    stripPrefix: EMOJI_LEAD,
  },

  detailed: {
    rules: {},
    structural: 'detailed',
    headerHint: 'message must have "Summary: …" (≤ 72 chars) as the first line, then "Details:" and "Effects:" sections with "- " bullets',
  },
};

/** Formats whose structure the project's commitlint parser can check directly. */
export const COMMITLINT_COMPATIBLE_FORMATS = new Set([
  'conventional', 'angular', 'atom', 'karma', 'semantic', 'google',
]);

/** Formats that read the repo's commitlint config in the builtin engine. */
export const CONFIG_DRIVEN_FORMATS = new Set(['conventional', 'angular']);
