export function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error));
}

const PATH_PATTERN = /(?:[A-Za-z]:[\\\/]|\/)[^\s:,'"]+\.[a-zA-Z]+/g;

export function sanitizeErrorForTelemetry(error: Error): { error: string; errorType: string } {
    return {
        error: error.message.replace(PATH_PATTERN, '<path>'),
        errorType: error.constructor.name,
    };
}
