import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ApiKeyValidator } from '../utils/apiKeyValidator';
import { AiServiceError, ConfigurationError } from '../models/errors';
import { toError } from '../utils/errorUtils';

interface ApiKeyConfig {
    secretKey: string;
    displayName: string;
    validator: (key: string) => string | null;
}

const API_KEY_CONFIGS: Record<string, ApiKeyConfig> = {
    gemini: {
        secretKey: 'commitsage.apiKey',
        displayName: 'Google',
        validator: ApiKeyValidator.validateGeminiApiKey,
    },
    openai: {
        secretKey: 'commitsage.openaiApiKey',
        displayName: 'OpenAI',
        validator: ApiKeyValidator.validateOpenAIApiKey,
    },
    codestral: {
        secretKey: 'commitsage.codestralApiKey',
        displayName: 'Codestral',
        validator: ApiKeyValidator.validateCodestralApiKey,
    },
    ollama: {
        secretKey: 'commitsage.ollamaAuthToken',
        displayName: 'Ollama',
        validator: ApiKeyValidator.validateOllamaAuthToken,
    },
};

export class ApiKeyManager {
    private static secretStorage: vscode.SecretStorage;

    static initialize(secretStorage: vscode.SecretStorage): void {
        this.secretStorage = secretStorage;
    }

    static requiresApiKey(provider: string): boolean {
        return provider in API_KEY_CONFIGS;
    }

    private static getConfig(provider: string): ApiKeyConfig {
        const config = API_KEY_CONFIGS[provider];
        if (!config) {
            throw new ConfigurationError(`Unknown API key provider: ${provider}`);
        }
        return config;
    }

    static async getKey(provider: string): Promise<string> {
        const config = this.getConfig(provider);
        try {
            let key = await this.secretStorage.get(config.secretKey);

            if (!key) {
                key = await vscode.window.showInputBox({
                    prompt: `Enter your ${config.displayName} API Key`,
                    ignoreFocusOut: true,
                    password: true,
                    validateInput: config.validator,
                });

                if (!key) {
                    throw new ConfigurationError(`${config.displayName} API key input was cancelled`);
                }

                await this.setKey(provider, key);
            }

            return key;
        } catch (error) {
            if (error instanceof ConfigurationError || error instanceof AiServiceError) {
                throw error;
            }
            Logger.error(`Error getting ${config.displayName} API key:`, toError(error));
            throw new AiServiceError(
                `Failed to get ${config.displayName} API key: ${(toError(error)).message}`
            );
        }
    }

    static async setKey(provider: string, key: string): Promise<void> {
        const config = this.getConfig(provider);
        try {
            const validationError = config.validator(key);
            if (validationError) {
                throw new AiServiceError(validationError);
            }

            await this.secretStorage.store(config.secretKey, key);
            Logger.log(`${config.displayName} API key has been validated and set`);
        } catch (error) {
            if (error instanceof AiServiceError) {
                throw error;
            }
            Logger.error(
                `Failed to validate and set ${config.displayName} API key:`,
                toError(error)
            );
            await Logger.showError(`Failed to set API key: ${(toError(error)).message}`);
            throw error;
        }
    }

    static async removeKey(provider: string): Promise<void> {
        const config = this.getConfig(provider);
        try {
            await this.secretStorage.delete(config.secretKey);
            Logger.log(`${config.displayName} API key has been removed`);
        } catch (error) {
            Logger.error(`Error removing ${config.displayName} API key:`, toError(error));
            throw error;
        }
    }

    static async getOptionalKey(provider: string): Promise<string | undefined> {
        const config = this.getConfig(provider);
        try {
            return await this.secretStorage.get(config.secretKey) ?? undefined;
        } catch (error) {
            Logger.error(`Error getting ${config.displayName} auth token:`, toError(error));
            return undefined;
        }
    }

    static async promptForKey(provider: string): Promise<void> {
        const config = this.getConfig(provider);
        const key = await vscode.window.showInputBox({
            prompt: `Enter your ${config.displayName} API Key`,
            ignoreFocusOut: true,
            password: true,
            validateInput: config.validator,
        });

        if (key) {
            await this.setKey(provider, key);
        }
    }
}
