
const apiValidation = {
    keyFormat: /^[A-Za-z0-9_-]+$/,
    openaiTestEndpoint: 'https://api.openai.com/v1/models',
    errorMessages: {
        emptyKey: 'API key cannot be empty',
        invalidChars: 'API key contains invalid characters',
        invalidFormat: 'Invalid API key format',
        invalidKey: 'Invalid API key',
        rateLimit: 'Rate limit exceeded',
        invalidEndpoint: 'Invalid endpoint URL',
        validationFailed: (status: number) => `API validation failed: ${status}`,
        customValidationFailed: (status: number) => `Custom API validation failed: ${status}`,
        invalidOpenaiKey: 'Invalid OpenAI API key format. Key should start with "sk-"'
    }
} as const;

export class ApiKeyValidator {
    static validateOpenAIApiKey(key: string): string | null {
        if (!key) {
            return apiValidation.errorMessages.emptyKey;
        }
        if (!key.startsWith('sk-')) {
            return apiValidation.errorMessages.invalidOpenaiKey;
        }
        return null;
    }

    static validateGeminiApiKey(key: string): string | null {
        if (!key) {
            return apiValidation.errorMessages.emptyKey;
        }
        if (!apiValidation.keyFormat.test(key)) {
            return apiValidation.errorMessages.invalidChars;
        }
        return null;
    }

    static validateCodestralApiKey(key: string): string | null {
        if (!key) {
            return apiValidation.errorMessages.emptyKey;
        }
        if (!apiValidation.keyFormat.test(key)) {
            return apiValidation.errorMessages.invalidChars;
        }
        return null;
    }
}
