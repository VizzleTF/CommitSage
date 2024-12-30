import axios, { AxiosError } from 'axios';
import { Logger } from './logger';
import { AiServiceError } from '../models/errors';

interface ApiHeaders {
    xGoogApiKey: string;
}

interface AuthHeaders {
    authBearer: string;
}

export class ApiKeyValidator {
    private static readonly geminiTestEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models';
    private static readonly minKeyLength = 32;
    private static readonly keyFormatRegex = /^[A-Za-z0-9_-]+$/;

    static async validateGeminiApiKey(key: string): Promise<boolean> {
        if (!this.isKeyFormatValid(key)) {
            throw new AiServiceError('Invalid API key format');
        }

        try {
            const headers: ApiHeaders = {
                xGoogApiKey: key
            };

            const requestHeaders = {
                apiKey: headers.xGoogApiKey
            };

            const response = await axios.get(this.geminiTestEndpoint, {
                headers: {
                    'x-goog-api-key': requestHeaders.apiKey
                }
            });

            return response.status === 200;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.response) {
                    switch (axiosError.response.status) {
                        case 401:
                        case 403:
                            throw new AiServiceError('Invalid API key');
                        case 429:
                            throw new AiServiceError('Rate limit exceeded');
                        default:
                            throw new AiServiceError(`API validation failed: ${axiosError.response.status}`);
                    }
                }
            }
            throw error;
        }
    }

    static async validateCustomApiKey(key: string, endpoint: string): Promise<boolean> {
        if (!this.isKeyFormatValid(key)) {
            throw new AiServiceError('Invalid API key format');
        }

        if (!this.validateEndpointUrl(endpoint)) {
            throw new AiServiceError('Invalid endpoint URL');
        }

        try {
            const headers: AuthHeaders = {
                authBearer: `Bearer ${key}`
            };

            const requestHeaders = {
                authorization: headers.authBearer
            };

            const response = await axios.get(endpoint, {
                headers: {
                    'Authorization': requestHeaders.authorization
                }
            });

            return response.status === 200;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.response) {
                    switch (axiosError.response.status) {
                        case 401:
                        case 403:
                            throw new AiServiceError('Invalid custom API key');
                        case 429:
                            throw new AiServiceError('Rate limit exceeded');
                        default:
                            throw new AiServiceError(`Custom API validation failed: ${axiosError.response.status}`);
                    }
                }
            }
            throw error;
        }
    }

    private static isKeyFormatValid(key: string): boolean {
        if (!key || typeof key !== 'string') {
            void Logger.error('API key must be a non-empty string');
            return false;
        }

        if (key.length < this.minKeyLength) {
            void Logger.error(`API key must be at least ${this.minKeyLength} characters long`);
            return false;
        }

        if (!this.keyFormatRegex.test(key)) {
            void Logger.error('API key contains invalid characters');
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