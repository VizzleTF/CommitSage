import axios, { AxiosError } from 'axios';
import { Logger } from './logger';
import { AiServiceError } from '../models/errors';

const API_VALIDATION = {
    KEY_FORMAT: /^[A-Za-z0-9_-]+$/,
    GEMINI_TEST_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models',
    OPENAI_TEST_ENDPOINT: 'https://api.openai.com/v1/models',
    ERROR_MESSAGES: {
        EMPTY_KEY: 'API key cannot be empty',
        INVALID_CHARS: 'API key contains invalid characters',
        INVALID_FORMAT: 'Invalid API key format',
        INVALID_KEY: 'Invalid API key',
        RATE_LIMIT: 'Rate limit exceeded',
        INVALID_ENDPOINT: 'Invalid endpoint URL',
        VALIDATION_FAILED: (status: number) => `API validation failed: ${status}`,
        CUSTOM_VALIDATION_FAILED: (status: number) => `Custom API validation failed: ${status}`,
        INVALID_OPENAI_KEY: 'Invalid OpenAI API key format. Key should start with "sk-"'
    }
} as const;

interface ApiResponse {
    status: number;
    data: unknown;
}

type ValidationResult = {
    isValid: boolean;
    error?: string;
};

export class ApiKeyValidator {
    static validateOpenAIApiKey(key: string): string | null {
        if (!key) {
            return API_VALIDATION.ERROR_MESSAGES.EMPTY_KEY;
        }
        if (!key.startsWith('sk-')) {
            return API_VALIDATION.ERROR_MESSAGES.INVALID_OPENAI_KEY;
        }
        return null;
    }

    static validateGeminiApiKey(key: string): string | null {
        if (!key) {
            return API_VALIDATION.ERROR_MESSAGES.EMPTY_KEY;
        }
        if (!API_VALIDATION.KEY_FORMAT.test(key)) {
            return API_VALIDATION.ERROR_MESSAGES.INVALID_CHARS;
        }
        return null;
    }

    static validateCodestralApiKey(key: string): string | null {
        if (!key) {
            return API_VALIDATION.ERROR_MESSAGES.EMPTY_KEY;
        }
        if (!API_VALIDATION.KEY_FORMAT.test(key)) {
            return API_VALIDATION.ERROR_MESSAGES.INVALID_CHARS;
        }
        return null;
    }

    static async validateOpenAIApiKeyOnline(key: string): Promise<boolean> {
        try {
            if (!key.startsWith('sk-')) {
                throw new AiServiceError(API_VALIDATION.ERROR_MESSAGES.INVALID_OPENAI_KEY);
            }

            const response = await axios.get(
                API_VALIDATION.OPENAI_TEST_ENDPOINT,
                {
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.status === 200;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                const status = axiosError.response.status;
                if (status === 401 || status === 403) {
                    throw new AiServiceError(API_VALIDATION.ERROR_MESSAGES.INVALID_KEY);
                }
                if (status === 429) {
                    throw new AiServiceError(API_VALIDATION.ERROR_MESSAGES.RATE_LIMIT);
                }
            }
            throw error;
        }
    }

    static async validateGeminiApiKeyOnline(key: string): Promise<boolean> {
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
                        'Content-Type': 'application/json'
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

    private static handleApiError(error: AxiosError): never {
        if (error.response) {
            const status = error.response.status;
            if (status === 401 || status === 403) {
                throw new AiServiceError(API_VALIDATION.ERROR_MESSAGES.INVALID_KEY);
            } else {
                throw new AiServiceError(API_VALIDATION.ERROR_MESSAGES.VALIDATION_FAILED(status));
            }
        }
        throw error;
    }
}
