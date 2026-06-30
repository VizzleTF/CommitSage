import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { AiServiceError, ConfigurationError, UserCancelledError } from '../models/errors';
import { toError } from '../utils/errorUtils';
import { ConfigService } from '../utils/configService';
import { PROVIDER_CATALOG, ProviderMeta, isProvider, providerMeta } from './providerCatalog';

export class ApiKeyManager {
    private static secretStorage: vscode.SecretStorage;
    private static readonly knownSecretKeys: Set<string> = new Set(
        PROVIDER_CATALOG.map(c => c.secretKey),
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
        if (!isProvider(provider)) {
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

    private static getConfig(provider: string): ProviderMeta {
        if (!isProvider(provider)) {
            throw new ConfigurationError(`Unknown API key provider: ${provider}`);
        }
        return providerMeta(provider);
    }

    /**
     * Shared "Enter your {provider} API Key" input box. Single home for the
     * prompt so `getKey` and `promptForKey` can't drift — `promptForKey` used
     * to send a non-localized literal while `getKey` localized it.
     */
    private static showApiKeyInputBox(config: ProviderMeta): Thenable<string | undefined> {
        return vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter your {0} API Key', config.displayName),
            ignoreFocusOut: true,
            password: true,
            validateInput: config.validateKey,
        });
    }

    static async getKey(provider: string): Promise<string> {
        const config = this.getConfig(provider);
        try {
            let key = await this.secretStorage.get(config.secretKey);

            if (!key) {
                key = await this.showApiKeyInputBox(config);

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
            const validationError = config.validateKey(key);
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
        const key = await this.showApiKeyInputBox(config);

        if (key) {
            await this.setKey(provider, key);
        } else {
            throw new UserCancelledError(`${config.displayName} API key input was cancelled`);
        }
    }
}
