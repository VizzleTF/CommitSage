export function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error));
}

const PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\/)[^\s:,'"]+\.[a-zA-Z]+/g;
const URL_KEY_PATTERN = /([?&])key=[^&\s'"]+/gi;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const GOOGLE_API_KEY_HEADER = /x-goog-api-key:\s*[^\s'",]+/gi;
const AUTHORIZATION_HEADER = /Authorization:\s*[^\s'",]+/gi;

export function sanitizeErrorForTelemetry(error: Error): { error: string; errorType: string } {
    const sanitized = error.message
        .replace(PATH_PATTERN, '<path>')
        .replace(URL_KEY_PATTERN, '$1key=<redacted>')
        .replace(BEARER_PATTERN, 'Bearer <redacted>')
        .replace(GOOGLE_API_KEY_HEADER, 'x-goog-api-key: <redacted>')
        .replace(AUTHORIZATION_HEADER, 'Authorization: <redacted>');
    return {
        error: sanitized,
        errorType: error.constructor.name,
    };
}
