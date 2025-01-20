import * as vscode from 'vscode';
import { Logger } from './logger';
import { ApiKeyValidator } from './apiKeyValidator';
import { AiServiceError, ConfigurationError } from '../models/errors';

type CacheValue = string | boolean | number;

export class ConfigService {
    private static cache = new Map<string, CacheValue>();
    private static secretStorage: vscode.SecretStorage;
    private static disposables: vscode.Disposable[] = [];

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.secretStorage = context.secrets;

        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('geminiCommit')) {
                this.clearCache();
                void Logger.log('Configuration changed, cache cleared');
            }
        });

        this.disposables.push(configListener);
        context.subscriptions.push(...this.disposables);
    }

    static getConfig<T extends CacheValue>(section: string, key: string, defaultValue: T): T {
        try {
            const cacheKey = `${section}.${key}`;
            if (!this.cache.has(cacheKey)) {
                const config = vscode.workspace.getConfiguration('geminiCommit');
                const value = config.inspect<T>(`${section}.${key}`);

                const effectiveValue = value?.workspaceValue ??
                    value?.globalValue ??
                    value?.defaultValue ??
                    defaultValue;

                this.cache.set(cacheKey, effectiveValue);
                void Logger.log(`Config loaded: ${cacheKey} = ${JSON.stringify(effectiveValue)}`);
            }
            return this.cache.get(cacheKey) as T;
        } catch (error) {
            void Logger.error(`Error getting config ${section}.${key}:`, error as Error);
            return defaultValue;
        }
    }

    static async getApiKey(): Promise<string> {
        try {
            let key = await this.secretStorage.get('geminicommit.apiKey');

            if (!key) {
                key = await vscode.window.showInputBox({
                    prompt: 'Enter your Google API Key',
                    ignoreFocusOut: true,
                    password: true,
                    validateInput: (value: string) => {
                        if (!value) { return 'API key cannot be empty'; }
                        if (value.length < 32) { return 'API key is too short'; }
                        if (!/^[A-Za-z0-9_-]+$/.test(value)) { return 'API key contains invalid characters'; }
                        return null;
                    }
                });

                if (!key) {
                    throw new ConfigurationError('API key input was cancelled');
                }

                await this.setApiKey(key);
            }

            return key;
        } catch (error) {
            void Logger.error('Error getting API key:', error as Error);
            throw new AiServiceError('Failed to get API key: ' + (error as Error).message);
        }
    }

    static async setApiKey(key: string): Promise<void> {
        try {
            await ApiKeyValidator.validateGeminiApiKey(key);

            await this.secretStorage.store('geminicommit.apiKey', key);
            void Logger.log('Google API key has been validated and set');

            await vscode.window.showInformationMessage('Google API key has been successfully validated and saved');
        } catch (error) {
            void Logger.error('Failed to validate and set Google API key:', error as Error);
            await vscode.window.showErrorMessage(`Failed to set API key: ${(error as Error).message}`);
            throw error;
        }
    }

    static async getCustomApiKey(): Promise<string> {
        try {
            let key = await this.secretStorage.get('geminicommit.customApiKey');

            if (!key) {
                const endpoint = this.getCustomEndpoint();
                if (!endpoint) {
                    throw new ConfigurationError('Custom endpoint URL is not set');
                }

                key = await vscode.window.showInputBox({
                    prompt: 'Enter your Custom API Key',
                    ignoreFocusOut: true,
                    password: true,
                    validateInput: (value: string) => {
                        if (!value) { return 'API key cannot be empty'; }
                        if (value.length < 32) { return 'API key is too short'; }
                        if (!/^[A-Za-z0-9_-]+$/.test(value)) { return 'API key contains invalid characters'; }
                        return null;
                    }
                });

                if (!key) {
                    throw new ConfigurationError('Custom API key input was cancelled');
                }

                await this.setCustomApiKey(key);
            }

            return key;
        } catch (error) {
            void Logger.error('Error getting custom API key:', error as Error);
            throw new AiServiceError('Failed to get custom API key: ' + (error as Error).message);
        }
    }

    static async setCustomApiKey(key: string): Promise<void> {
        try {
            const endpoint = this.getCustomEndpoint();
            if (!endpoint) {
                throw new ConfigurationError('Custom endpoint URL is not set');
            }

            await ApiKeyValidator.validateCustomApiKey(key, endpoint);
            await this.secretStorage.store('geminicommit.customApiKey', key);
            void Logger.log('Custom API key has been validated and set');
            await vscode.window.showInformationMessage('Custom API key has been successfully validated and saved');
        } catch (error) {
            void Logger.error('Failed to validate and set custom API key:', error as Error);
            await vscode.window.showErrorMessage(`Failed to set custom API key: ${(error as Error).message}`);
            throw error;
        }
    }

    static async removeApiKey(): Promise<void> {
        try {
            await this.secretStorage.delete('geminicommit.apiKey');
            void Logger.log('Google API key has been removed');
            await vscode.window.showInformationMessage('Google API key has been removed');
        } catch (error) {
            void Logger.error('Error removing Google API key:', error as Error);
            throw error;
        }
    }

    static async removeCustomApiKey(): Promise<void> {
        try {
            await this.secretStorage.delete('geminicommit.customApiKey');
            void Logger.log('Custom API key has been removed');
            await vscode.window.showInformationMessage('Custom API key has been removed');
        } catch (error) {
            void Logger.error('Error removing custom API key:', error as Error);
            throw error;
        }
    }

    static getGeminiModel(): string {
        return this.getConfig<string>('gemini', 'model', 'gemini-1.5-flash');
    }

    static getCommitLanguage(): string {
        return this.getConfig<string>('commit', 'commitLanguage', 'english');
    }

    static getCommitFormat(): string {
        return this.getConfig<string>('commit', 'commitFormat', 'conventional');
    }

    static useCustomInstructions(): boolean {
        return this.getConfig<boolean>('commit', 'useCustomInstructions', false);
    }

    static getCustomInstructions(): string {
        return this.getConfig<string>('commit', 'customInstructions', '');
    }

    static useCustomEndpoint(): boolean {
        return this.getConfig<boolean>('custom', 'useCustomEndpoint', false);
    }

    static getCustomEndpoint(): string {
        return this.getConfig<string>('custom', 'endpoint', '');
    }

    static getCustomModel(): string {
        return this.getConfig<string>('custom', 'model', '');
    }

    static shouldPromptForRefs(): boolean {
        return this.getConfig<boolean>('commit', 'promptForRefs', false);
    }

    static getOnlyStagedChanges(): boolean {
        return this.getConfig<boolean>('commit', 'onlyStagedChanges', false);
    }

    static getMaxRetries(): number {
        return this.getConfig<number>('general', 'maxRetries', 3);
    }

    static getInitialRetryDelay(): number {
        return this.getConfig<number>('general', 'initialRetryDelayMs', 1000);
    }

    static getAutoCommitEnabled(): boolean {
        return this.getConfig<boolean>('commit', 'autoCommit', false);
    }

    static getAutoPushEnabled(): boolean {
        return this.getConfig<boolean>('commit', 'autoPush', false);
    }

    static async validateAutoPushState(): Promise<void> {
        const isAutoPushEnabled = this.getAutoPushEnabled();
        const isAutoCommitEnabled = this.getAutoCommitEnabled();

        if (isAutoPushEnabled && !isAutoCommitEnabled) {
            const selection = await vscode.window.showWarningMessage(
                'Auto Push requires Auto Commit to be enabled.',
                {
                    modal: true,
                    detail: 'Choose how to resolve this configuration conflict'
                },
                { title: 'Enable Auto Commit', isCloseAffordance: false },
                { title: 'Disable Auto Push', isCloseAffordance: false },
                { title: 'Open Settings', isCloseAffordance: true }
            );

            const config = vscode.workspace.getConfiguration('geminiCommit');

            switch (selection?.title) {
                case 'Enable Auto Commit':
                    await config.update('commit.autoCommit', true, vscode.ConfigurationTarget.Global);
                    break;
                case 'Disable Auto Push':
                    await config.update('commit.autoPush', false, vscode.ConfigurationTarget.Global);
                    break;
                case 'Open Settings':
                    await vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        '@ext:VizzleTF.geminicommit commit'
                    );
                    break;
            }
        }
    }

    static clearCache(): void {
        this.cache.clear();
        void Logger.log('Configuration cache cleared');
    }

    static dispose(): void {
        this.disposables.forEach(d => void d.dispose());
        this.disposables = [];
        this.clearCache();
    }

    static async promptForApiKey(): Promise<void> {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Google API Key',
            ignoreFocusOut: true,
            password: true,
            validateInput: ApiKeyValidator.validateApiKey
        });

        if (key) {
            await this.setApiKey(key);
        }
    }

    static async promptForCustomApiKey(): Promise<void> {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Custom API Key',
            ignoreFocusOut: true,
            password: true,
            validateInput: ApiKeyValidator.validateApiKey
        });

        if (key) {
            await this.setCustomApiKey(key);
        }
    }
}