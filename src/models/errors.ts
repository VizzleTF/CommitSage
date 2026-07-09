export class GitExtensionNotFoundError extends Error {
    constructor() {
        super('Git extension not found. Please make sure it is installed and enabled.');
        this.name = 'GitExtensionNotFoundError';
    }
}

export class NoRepositoriesFoundError extends Error {
    constructor() {
        super('No Git repositories found in the current workspace.');
        this.name = 'NoRepositoriesFoundError';
    }
}

export class NoChangesDetectedError extends Error {
    constructor(message: string = 'No changes detected.') {
        super(message);
        this.name = 'NoChangesDetectedError';
    }
}

export class NoRepositorySelectedError extends Error {
    constructor() {
        super('No repository selected. Operation cancelled.');
        this.name = 'NoRepositorySelectedError';
    }
}

export class AiServiceError extends Error {
    constructor(message: string) {
        super(`AI service error: ${message}`);
        this.name = 'AiServiceError';
    }
}

export class ConfigurationError extends Error {
    constructor(message: string) {
        super(`Configuration error: ${message}`);
        this.name = 'ConfigurationError';
    }
}

export class UserCancelledError extends Error {
    constructor(message: string = 'Operation cancelled by user') {
        super(message);
        this.name = 'UserCancelledError';
    }
}

export class ApiKeyInvalidError extends Error {
    constructor(provider: string) {
        super(`Invalid or expired API key for ${provider}`);
        this.name = 'ApiKeyInvalidError';
    }
}

/**
 * The provider stopped mid-message because it ran out of output tokens, so the
 * commit message we got back is cut off (#447). Retryable: `resolveMaxOutputTokens`
 * doubles the budget on each attempt, so the retry is not a repeat of the same call.
 */
export class TruncatedResponseError extends Error {
    constructor(provider: string, detail: string) {
        super(
            `${provider} stopped generating before the message was complete (${detail}). ` +
            'Raise `commitSage.general.maxOutputTokens` if this keeps happening.'
        );
        this.name = 'TruncatedResponseError';
    }
}