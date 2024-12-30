import axios from 'axios';
import { Logger } from './logger';
import { AiServiceError } from '../models/errors';

export class ApiKeyValidator {
    private static readonly GEMINI_TEST_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
    private static readonly MIN_KEY_LENGTH = 32;
    private static readonly KEY_FORMAT_REGEX = /^[A-Za-z0-9_-]+$/;

    static async validateGeminiApiKey(key: string): Promise<boolean> {
        try {
            if (!this.validateKeyFormat(key)) {
                throw new AiServiceError('Invalid API key format');
            }

            const response = await axios.get(`${this.GEMINI_TEST_ENDPOINT}`, {
                headers: {
                    'x-goog-api-key': key
                }
            });

            return response.status === 200;
        } catch (error: any) {
            if (error.response) {
                switch (error.response.status) {
                    case 401:
                    case 403:
                        throw new AiServiceError('Invalid API key');
                    case 429:
                        throw new AiServiceError('Rate limit exceeded');
                    default:
                        throw new AiServiceError(`API validation failed: ${error.response.status}`);
                }
            }
            throw error;
        }
    }

    static async validateCustomApiKey(key: string, endpoint: string): Promise<boolean> {
        try {
            if (!this.validateKeyFormat(key)) {
                throw new AiServiceError('Invalid API key format');
            }

            if (!this.validateEndpointUrl(endpoint)) {
                throw new AiServiceError('Invalid endpoint URL');
            }

            const response = await axios.get(endpoint, {
                headers: {
                    'Authorization': `Bearer ${key}`
                }
            });

            return response.status === 200;
        } catch (error: any) {
            if (error.response) {
                switch (error.response.status) {
                    case 401:
                    case 403:
                        throw new AiServiceError('Invalid custom API key');
                    case 429:
                        throw new AiServiceError('Rate limit exceeded');
                    default:
                        throw new AiServiceError(`Custom API validation failed: ${error.response.status}`);
                }
            }
            throw error;
        }
    }

    private static validateKeyFormat(key: string): boolean {
        if (!key || typeof key !== 'string') {
            Logger.error('API key must be a non-empty string');
            return false;
        }

        if (key.length < this.MIN_KEY_LENGTH) {
            Logger.error(`API key must be at least ${this.MIN_KEY_LENGTH} characters long`);
            return false;
        }

        if (!this.KEY_FORMAT_REGEX.test(key)) {
            Logger.error('API key contains invalid characters');
            return false;
        }

        return true;
    }

    private static validateEndpointUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
}