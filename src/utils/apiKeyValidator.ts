import axios, { AxiosError } from 'axios';
import { AiServiceError } from '../models/errors';

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

    static async validateOpenAIApiKeyOnline(key: string): Promise<boolean> {
        try {
            if (!key.startsWith('sk-')) {
                throw new AiServiceError(apiValidation.errorMessages.invalidOpenaiKey);
            }

            const response = await axios.get(
                apiValidation.openaiTestEndpoint,
                {
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        contentType: 'application/json'
                    }
                }
            );

            return response.status === 200;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                const status = axiosError.response.status;
                if (status === 401 || status === 403) {
                    throw new AiServiceError(apiValidation.errorMessages.invalidKey);
                }
                if (status === 429) {
                    throw new AiServiceError(apiValidation.errorMessages.rateLimit);
                }
            }
            throw error;
        }
    }
    // eslint-disable-next-line no-unused-vars
    static async validateGeminiApiKeyOnline(_key: string): Promise<boolean> {
        return true; // TODO: Implement online validation for Gemini API
    }

    static async validateCodestralApiKeyOnline(key: string): Promise<boolean> {
        try {
            const response = await axios.post(
                'https://codestral.mistral.ai/v1/chat/completions',
                {
                    model: 'codestral-2405',
                    messages: [{ role: 'user', content: 'Test message' }]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        contentType: 'application/json'
                    }
                }
            );

            return response.status === 200;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                const status = axiosError.response.status;
                if (status === 401 || status === 403) {
                    return false;
                }
            }
            throw error;
        }
    }

}
