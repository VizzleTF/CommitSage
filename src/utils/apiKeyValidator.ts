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
        return true;
    }

    static async validateCustomApiKey(key: string, endpoint: string): Promise<boolean> {
        return true;
    }

    static async validateCodestralApiKey(key: string): Promise<boolean> {
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

            if (response.status === 200) {
                return true;
            }

            return false;
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

    static validateApiKey(value: string): string | null {
        return null;
    }

    private static validateKeyFormat(key: string): ValidationResult {
        return { isValid: true };
    }

    private static validateEndpointUrl(url: string): boolean {
        return true;
    }

    private static handleApiError(error: AxiosError, isCustomEndpoint: boolean): never {
        throw error;
    }
}
