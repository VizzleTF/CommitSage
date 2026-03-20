import { ApiErrorResult } from '../models/types';
import { errorMessages } from '../utils/constants';
import { AxiosError } from 'axios';

export class BaseAIService {
    static validateCommitMessage(message: string): string {
        const cleanMessage = message.trim();
        if (!cleanMessage) {
            throw new Error("Generated commit message is empty.");
        }
        return cleanMessage;
    }

    static extractAndValidateMessage(content: string | undefined | null, serviceName: string): string {
        if (!content) {
            throw new Error(`Invalid response format from ${serviceName} API`);
        }
        return this.validateCommitMessage(content);
    }

    static handleHttpError(error: Error, serviceName: string): ApiErrorResult {
        if (error instanceof AxiosError) {
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data as { error?: { message?: string } };
                const errorMessage = data.error?.message;

                switch (status) {
                    case 401:
                        return {
                            errorMessage: errorMessages.authenticationError,
                            shouldRetry: false,
                            statusCode: status
                        };
                    case 402:
                        return {
                            errorMessage: errorMessages.paymentRequired,
                            shouldRetry: false,
                            statusCode: status
                        };
                    case 429:
                        return {
                            errorMessage: errorMessages.rateLimitExceeded,
                            shouldRetry: true,
                            statusCode: status
                        };
                    case 422:
                        return {
                            errorMessage: errorMessage || errorMessages.invalidRequest,
                            shouldRetry: false,
                            statusCode: status
                        };
                    case 500:
                        return {
                            errorMessage: errorMessages.serverError,
                            shouldRetry: true,
                            statusCode: status
                        };
                    default: {
                        const responseData = JSON.stringify(error.response.data);
                        return {
                            errorMessage: `${errorMessages.apiError.replace('{0}', String(status))}: ${errorMessage || responseData}`,
                            shouldRetry: status >= 500,
                            statusCode: status
                        };
                    }
                }
            }

            if (error.code === 'ECONNREFUSED' ||
                error.code === 'ETIMEDOUT' ||
                error.message?.includes('ECONNREFUSED') ||
                error.message?.includes('ETIMEDOUT')) {
                return {
                    errorMessage: `Could not connect to ${serviceName}. Please check your internet connection.`,
                    shouldRetry: true
                };
            }
        }

        return {
            errorMessage: error.message || 'Unknown error',
            shouldRetry: false
        };
    }

}