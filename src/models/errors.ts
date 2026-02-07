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

export class OpenAIError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OpenAIError';
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