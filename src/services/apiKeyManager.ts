import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ApiKeyValidator } from '../utils/apiKeyValidator';
import { AiServiceError, ConfigurationError, UserCancelledError } from '../models/errors';
import { toError } from '../utils/errorUtils';
import { ConfigService } from '../utils/configService';

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
    openrouter: {
        secretKey: 'commitsage.openrouterApiKey',
        displayName: 'OpenRouter',
        validator: ApiKeyValidator.validateOpenRouterApiKey,
    },
    groq: {
        secretKey: 'commitsage.groqApiKey',
        displayName: 'Groq',
        validator: ApiKeyValidator.validateGroqApiKey,
    },
    anthropic: {
        secretKey: 'commitsage.anthropicApiKey',
        displayName: 'Anthropic',
        validator: ApiKeyValidator.validateAnthropicApiKey,
    },
    deepseek: {
        secretKey: 'commitsage.deepseekApiKey',
        displayName: 'DeepSeek',
        validator: ApiKeyValidator.validateDeepSeekApiKey,
    },
    xai: {
        secretKey: 'commitsage.xaiApiKey',
        displayName: 'xAI',
        validator: ApiKeyValidator.validateXaiApiKey,
    },
    custom: {
        secretKey: 'commitsage.customApiKey',
        displayName: 'Custom',
        validator: ApiKeyValidator.validateCustomApiKey,
    },
};

export class ApiKeyManager {
    private static secretStorage: vscode.SecretStorage;
    private static readonly knownSecretKeys: Set<string> = new Set(
        Object.values(API_KEY_CONFIGS).map(c => c.secretKey),
    );

    static initialize(secretStorage: vscode.SecretStorage, context: vscode.ExtensionContext): void {
        this.secretStorage = secretStorage;
        // SecretStorage is shared across windows and (in Remote scenarios)
        // across host/client. Without this listener a second window or remote
        // host would keep using the stale key after a rotation.
        context.subscriptions.push(
            secretStorage.onDidChange(e => {
                if (this.knownSecretKeys.has(e.key)) {
                    Logger.log(`API key updated externally: ${e.key}`);
                }
            }),
        );
    }

    /**
     * Whether the current configuration requires an API key/auth token.
     * For ollama also consults `ollama.useAuthToken` since auth is opt-in
     * for self-hosted Ollama.
     */
    static requiresKeyForCurrentConfig(provider: string): boolean {
        if (!(provider in API_KEY_CONFIGS)) {
            return false;
        }
        if (provider === 'ollama') {
            return ConfigService.get('ollama.useAuthToken');
        }
        if (provider === 'custom') {
            return ConfigService.get('custom.useApiKey');
        }
        return true;
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
                    prompt: vscode.l10n.t('Enter your {0} API Key', config.displayName),
                    ignoreFocusOut: true,
                    password: true,
                    validateInput: config.validator,
                });

                if (!key) {
                    throw new UserCancelledError(`${config.displayName} API key input was cancelled`);
                }

                await this.setKey(provider, key);
            }

            return key;
        } catch (error) {
            if (error instanceof UserCancelledError || error instanceof ConfigurationError || error instanceof AiServiceError) {
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
            await Logger.showError(vscode.l10n.t('Failed to set API key: {0}', toError(error).message));
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
        } else {
            throw new UserCancelledError(`${config.displayName} API key input was cancelled`);
        }
    }
}
