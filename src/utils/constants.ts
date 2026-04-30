export const SUPPORTED_LANGUAGES = ['english', 'russian', 'chinese', 'japanese', 'korean', 'german', 'french', 'spanish', 'portuguese', 'custom'] as const;
export type CommitLanguage = typeof SUPPORTED_LANGUAGES[number];

export const errorMessages = {
    apiError: 'API Error: {0}',
    fileNotFound: 'File not found',
    paymentRequired: 'Payment Required: Your API key requires a valid subscription or has exceeded its quota. Please check your billing status.',
    invalidRequest: 'Invalid Request: The request was malformed or the input was invalid. This may happen if the content is too long or contains unsupported characters.',
    rateLimitExceeded: 'Rate Limit Exceeded: Too many requests in a short time period. Please wait a moment before trying again.',
    serverError: 'Server Error: The service is temporarily unavailable. Please try again later.',
    authenticationError: 'Authentication Error: The API key is invalid or has been revoked. Please check your API key.',
    noChanges: 'No changes to commit',
    noCommitsYet: 'Repository has no commits yet',
};