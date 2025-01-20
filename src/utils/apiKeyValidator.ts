import axios, { AxiosError } from 'axios';
import { Logger } from './logger';
import { AiServiceError } from '../models/errors';

const API_VALIDATION = {
    MIN_KEY_LENGTH: 32,
    KEY_FORMAT: /^[A-Za-z0-9_-]+$/,
    GEMINI_TEST_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models',
    ERROR_MESSAGES: {
        EMPTY_KEY: 'API key cannot be empty',
        SHORT_KEY: 'API key must be at least 32 characters long',
        INVALID_CHARS: 'API key contains invalid characters',
        INVALID_FORMAT: 'Invalid API key format',
        INVALID_KEY: 'Invalid API key',
        RATE_LIMIT: 'Rate limit exceeded',
        INVALID_ENDPOINT: 'Invalid endpoint URL',
        VALIDATION_FAILED: (status: number) => `API validation failed: ${status}`,
        CUSTOM_VALIDATION_FAILED: (status: number) => `Custom API validation failed: ${status}`
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
    static async validateGeminiApiKey(key: string): Promise<boolean> {
        const formatValidation = this.validateKeyFormat(key);
        if (!formatValidation.isValid) {
            throw new AiServiceError(formatValidation.error || API_VALIDATION.ERROR_MESSAGES.INVALID_FORMAT);
        }

        try {
            const response = await axios.get<ApiResponse>(API_VALIDATION.GEMINI_TEST_ENDPOINT, {
                headers: {
                    'x-goog-api-key': key
                }
            });

            return response.status === 200;
        } catch (error) {
            this.handleApiError(error as AxiosError, false);
            return false;
        }
    }

    static async validateCustomApiKey(key: string, endpoint: string): Promise<boolean> {
        const formatValidation = this.validateKeyFormat(key);
        if (!formatValidation.isValid) {
            throw new AiServiceError(formatValidation.error || API_VALIDATION.ERROR_MESSAGES.INVALID_FORMAT);
        }

        if (!this.validateEndpointUrl(endpoint)) {
            throw new AiServiceError(API_VALIDATION.ERROR_MESSAGES.INVALID_ENDPOINT);
        }

        try {
            const response = await axios.get<ApiResponse>(endpoint, {
                headers: {
                    'Authorization': `Bearer ${key}`
                }
            });

            return response.status === 200;
        } catch (error) {
            this.handleApiError(error as AxiosError, true);
            return false;
        }
    }

    static validateApiKey(value: string): string | null {
        const validation = this.validateKeyFormat(value);
        return validation.error || null;
    }

    private static validateKeyFormat(key: string): ValidationResult {
        if (!key || typeof key !== 'string') {
            void Logger.error(API_VALIDATION.ERROR_MESSAGES.EMPTY_KEY);
            return { isValid: false, error: API_VALIDATION.ERROR_MESSAGES.EMPTY_KEY };
        }

        if (key.length < API_VALIDATION.MIN_KEY_LENGTH) {
            void Logger.error(API_VALIDATION.ERROR_MESSAGES.SHORT_KEY);
            return { isValid: false, error: API_VALIDATION.ERROR_MESSAGES.SHORT_KEY };
        }

        if (!API_VALIDATION.KEY_FORMAT.test(key)) {
            void Logger.error(API_VALIDATION.ERROR_MESSAGES.INVALID_CHARS);
            return { isValid: false, error: API_VALIDATION.ERROR_MESSAGES.INVALID_CHARS };
        }

        return { isValid: true };
    }

    private static validateEndpointUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            void Logger.error(API_VALIDATION.ERROR_MESSAGES.INVALID_ENDPOINT);
            return false;
        }
    }

    private static handleApiError(error: AxiosError, isCustomEndpoint: boolean): never {
        if (error.response) {
            const { status } = error.response;
            switch (status) {
                case 401:
                case 403:
                    throw new AiServiceError(
                        isCustomEndpoint ? 'Invalid custom API key' : API_VALIDATION.ERROR_MESSAGES.INVALID_KEY
                    );
                case 429:
                    throw new AiServiceError(API_VALIDATION.ERROR_MESSAGES.RATE_LIMIT);
                default:
                    throw new AiServiceError(
                        isCustomEndpoint
                            ? API_VALIDATION.ERROR_MESSAGES.CUSTOM_VALIDATION_FAILED(status)
                            : API_VALIDATION.ERROR_MESSAGES.VALIDATION_FAILED(status)
                    );
            }
        }
        throw error;
    }
}