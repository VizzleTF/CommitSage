import * as vscode from 'vscode';
import { Logger } from './logger';
import { ApiKeyValidator } from './apiKeyValidator';
import { AiServiceError, ConfigurationError } from '../models/errors';
import { CustomEndpointService } from '../services/customEndpointService';

type CacheValue = string | boolean | number;

export type CommitLanguage = typeof SUPPORTED_LANGUAGES[number];
const SUPPORTED_LANGUAGES = ['english', 'russian', 'chinese', 'japanese'] as const;

export class ConfigService {
    private static cache = new Map<string, CacheValue>();
    private static secretStorage: vscode.SecretStorage;
    private static disposables: vscode.Disposable[] = [];

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        void Logger.log('Initializing ConfigService');
        this.secretStorage = context.secrets;

        const configListener = vscode.workspace.onDidChangeConfiguration(async event => {
            if (event.affectsConfiguration('commitSage')) {
                this.clearCache();
                void Logger.log('Configuration changed, cache cleared');

                // Validate endpoint if custom endpoint settings changed
                if (event.affectsConfiguration('commitSage.custom.endpoint') ||
                    event.affectsConfiguration('commitSage.custom.useCustomEndpoint')) {
                    const useCustomEndpoint = this.useCustomEndpoint();
                    const endpoint = this.getCustomEndpoint();

                    if (useCustomEndpoint && endpoint) {
                        void Logger.log('Custom endpoint changed, validating new endpoint');
                        await this.validateAndNormalizeEndpoint(endpoint)
                            .then(async normalizedEndpoint => {
                                if (normalizedEndpoint && normalizedEndpoint !== endpoint) {
                                    const config = vscode.workspace.getConfiguration('commitSage');
                                    await config.update('custom.endpoint', normalizedEndpoint, true);
                                    void Logger.log('Endpoint normalized and updated');
                                }
                            })
                            .catch(error => {
                                void Logger.error('Failed to validate new endpoint:', error);
                            });
                    }
                }
            }
        });

        this.disposables.push(configListener);
        context.subscriptions.push(...this.disposables);
        void Logger.log('ConfigService initialized successfully');
    }

    static getConfig<T extends CacheValue>(section: string, key: string, defaultValue: T): T {
        try {
            const cacheKey = `${section}.${key}`;
            if (!this.cache.has(cacheKey)) {
                void Logger.log(`Loading config for ${cacheKey}`);
                const config = vscode.workspace.getConfiguration('commitSage');
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
            let key = await this.secretStorage.get('commitsage.apiKey');

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

            await this.secretStorage.store('commitsage.apiKey', key);
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
            let key = await this.secretStorage.get('commitsage.customApiKey');

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
            await this.secretStorage.store('commitsage.customApiKey', key);
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
            await this.secretStorage.delete('commitsage.apiKey');
            void Logger.log('Google API key has been removed');
            await vscode.window.showInformationMessage('Google API key has been removed');
        } catch (error) {
            void Logger.error('Error removing Google API key:', error as Error);
            throw error;
        }
    }

    static async removeCustomApiKey(): Promise<void> {
        try {
            await this.secretStorage.delete('commitsage.customApiKey');
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

            const config = vscode.workspace.getConfiguration('commitSage');

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
                        '@ext:VizzleTF.commitsage commit'
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

    static isTelemetryEnabled(): boolean {
        return this.getConfig<boolean>('telemetry', 'enabled', true);
    }

    private static handleConfigChange(event: vscode.ConfigurationChangeEvent): void {
        if (event.affectsConfiguration('commitSage')) {
            void this.loadConfig();
        }
    }

    private static async loadConfig(): Promise<void> {
        const config = vscode.workspace.getConfiguration('commitSage');
        // ... existing code ...
    }

    public static getCommandId(): string {
        return '@ext:VizzleTF.commitsage commit';
    }

    private static getEndpointVariants(inputUrl: string): string[] {
        const url = new URL(inputUrl);
        const variants: string[] = [];

        const baseUrl = url.origin + url.pathname.replace(/\/+$/, '');

        const withoutCompletions = baseUrl.replace(/\/chat\/completions$/, '');

        const withoutVersion = withoutCompletions.replace(/\/v1$/, '');

        const withoutApi = withoutVersion.replace(/\/api$/, '');

        variants.push(baseUrl);
        if (baseUrl !== withoutCompletions) variants.push(withoutCompletions);
        if (withoutCompletions !== withoutVersion) variants.push(withoutVersion);
        if (withoutVersion !== withoutApi) variants.push(withoutApi);

        if (!withoutApi.endsWith('/api')) {
            variants.push(`${withoutApi}/api`);
        }

        return [...new Set(variants)];
    }

    static async validateAndNormalizeEndpoint(endpoint: string): Promise<string | null> {
        try {
            const apiKey = await this.getCustomApiKey();
            if (!apiKey) {
                throw new ConfigurationError('Custom API key is not set');
            }

            const variants = this.getEndpointVariants(endpoint);

            for (const variant of variants) {
                const models = await CustomEndpointService.fetchAvailableModels(variant, apiKey);
                if (models.length > 0) {
                    void vscode.window.showInformationMessage(
                        `Available models: ${models.join(', ')}`,
                        { modal: false }
                    );
                    return variant;
                }
            }

            void vscode.window.showWarningMessage(
                `Unable to validate endpoint "${endpoint}" and fetch available models. Please verify the endpoint URL and API key.`,
                { modal: false }
            );
            return null;
        } catch (error) {
            void vscode.window.showWarningMessage(
                `Unable to validate endpoint "${endpoint}" and fetch available models. Please verify the endpoint URL and API key.`,
                { modal: false }
            );
            return null;
        }
    }

    static async setCustomEndpoint(endpoint: string): Promise<void> {
        try {
            const normalizedEndpoint = await this.validateAndNormalizeEndpoint(endpoint);
            if (!normalizedEndpoint) {
                throw new ConfigurationError('Failed to validate endpoint');
            }

            const config = vscode.workspace.getConfiguration('commitSage');
            await config.update('custom.endpoint', normalizedEndpoint, true);
            void Logger.log('Custom endpoint has been validated and set');
            await vscode.window.showInformationMessage('Custom endpoint has been successfully validated and saved');
        } catch (error) {
            void Logger.error('Failed to validate and set custom endpoint:', error as Error);
            await vscode.window.showErrorMessage(`Failed to set custom endpoint: ${(error as Error).message}`);
            throw error;
        }
    }
}