// Browser-safe (no `vscode`/Node imports): the webview bundle imports this
// module too, so these lists and format rules have one home for both sides.
// package.json mirrors the enums; tests/configDefaults.test.ts checks the drift.

export const SUPPORTED_LANGUAGES = ['english', 'russian', 'chinese', 'japanese', 'korean', 'german', 'french', 'spanish', 'portuguese', 'custom'] as const;
export type CommitLanguage = typeof SUPPORTED_LANGUAGES[number];

/** Every `commitSage.commit.commitFormat` value; all but `custom` have a prompt template. */
export const COMMIT_FORMATS = ['conventional', 'angular', 'karma', 'semantic', 'emoji', 'emojiKarma', 'google', 'atom', 'detailed', 'previous', 'custom'] as const;

/** `commitSage.gemini.thinkingLevel` values. */
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;

/** Formats the project's commitlint parser can check directly. */
export const COMMITLINT_COMPATIBLE_FORMATS: ReadonlySet<string> = new Set([
    'conventional', 'angular', 'atom', 'karma', 'semantic', 'google',
]);

/** Formats that read the repo's commitlint config in the builtin engine. */
export const CONFIG_DRIVEN_FORMATS: ReadonlySet<string> = new Set(['conventional', 'angular']);

/**
 * `custom` format means "use the user's customInstructions verbatim", so the
 * `useCustomInstructions` gate must track it.
 */
export function formatUsesCustomInstructions(format: string): boolean {
    return format === 'custom';
}

/**
 * Commitlint validation needs a fixed structure: a free-form custom prompt and
 * the history-driven `previous` format have none, so validation is skipped and
 * the settings panel disables the checkbox for them.
 */
export function formatSupportsCommitlint(format: string): boolean {
    return format !== 'custom' && format !== 'previous';
}

export const errorMessages = {
    apiError: 'API Error: {0}',
    paymentRequired: 'Payment Required: Your API key requires a valid subscription or has exceeded its quota. Please check your billing status.',
    invalidRequest: 'Invalid Request: The request was malformed or the input was invalid. This may happen if the content is too long or contains unsupported characters.',
    rateLimitExceeded: 'Rate Limit Exceeded: Too many requests in a short time period. Please wait a moment before trying again.',
    serverError: 'Server Error: The service is temporarily unavailable. Please try again later.',
    authenticationError: 'Authentication Error: The API key is invalid or has been revoked. Please check your API key.',
};
