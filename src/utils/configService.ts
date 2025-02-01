import * as vscode from 'vscode';
import { Logger } from './logger';
import { ApiKeyValidator } from './apiKeyValidator';
import { AiServiceError, ConfigurationError } from '../models/errors';

type CacheValue = string | boolean | number;

export type CommitLanguage = 'english' | 'russian' | 'chinese' | 'japanese';

export class ConfigService {
    private static cache = new Map<string, CacheValue>();
    private static secretStorage: vscode.SecretStorage;
    private static disposables: vscode.Disposable[] = [];

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.secretStorage = context.secrets;

        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('commitSage')) {
                this.clearCache();
                if (event.affectsConfiguration('commitSage.openai.baseUrl')) {
                    const baseUrl = this.getOpenAIBaseUrl();
                    if (baseUrl) {
                        try {
                            const normalizedEndpoint = this.validateAndNormalizeEndpoint(baseUrl);
                            const config = vscode.workspace.getConfiguration('commitSage');
                            void config.update('openai.baseUrl', normalizedEndpoint, true);
                        } catch (error: unknown) {
                            void Logger.error('Failed to update OpenAI base URL:', error as Error);
                        }
                    }
                }
            }
        });

        this.disposables.push(configListener);
        context.subscriptions.push(...this.disposables);
    }

    static getConfig<T extends CacheValue>(section: string, key: string, defaultValue: T): T {
        try {
            const cacheKey = `${section}.${key}`;
            if (!this.cache.has(cacheKey)) {
                const config = vscode.workspace.getConfiguration('commitSage');
                const value = config.inspect<T>(`${section}.${key}`);

                const effectiveValue = value?.workspaceValue ??
                    value?.globalValue ??
                    value?.defaultValue ??
                    defaultValue;

                this.cache.set(cacheKey, effectiveValue);
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
            const validationError = ApiKeyValidator.validateGeminiApiKey(key);
            if (validationError) {
                throw new AiServiceError(validationError);
            }

            await this.secretStorage.store('commitsage.apiKey', key);
            await vscode.window.showInformationMessage('Google API key has been successfully validated and saved');
        } catch (error) {
            void Logger.error('Failed to validate and set Google API key:', error as Error);
            await vscode.window.showErrorMessage(`Failed to set API key: ${(error as Error).message}`);
            throw error;
        }
    }

    static async getCodestralApiKey(): Promise<string> {
        try {
            let key = await this.secretStorage.get('commitsage.codestralApiKey');

            if (!key) {
                key = await vscode.window.showInputBox({
                    prompt: 'Enter your Codestral API Key',
                    ignoreFocusOut: true,
                    password: true
                });

                if (!key) {
                    throw new ConfigurationError('Codestral API key input was cancelled');
                }

                await this.setCodestralApiKey(key);
            }

            return key;
        } catch (error) {
            void Logger.error('Error getting Codestral API key:', error as Error);
            throw new AiServiceError('Failed to get Codestral API key: ' + (error as Error).message);
        }
    }

    static async setCodestralApiKey(key: string): Promise<void> {
        try {
            const validationError = ApiKeyValidator.validateCodestralApiKey(key);
            if (validationError) {
                throw new AiServiceError(validationError);
            }

            await this.secretStorage.store('commitsage.codestralApiKey', key);
            void Logger.log('Codestral API key has been validated and set');

            await vscode.window.showInformationMessage('Codestral API key has been successfully validated and saved');
        } catch (error) {
            void Logger.error('Failed to validate and set Codestral API key:', error as Error);
            await vscode.window.showErrorMessage(`Failed to set API key: ${(error as Error).message}`);
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

    static async removeCodestralApiKey(): Promise<void> {
        try {
            await this.secretStorage.delete('commitsage.codestralApiKey');
            void Logger.log('Codestral API key has been removed');
            await vscode.window.showInformationMessage('Codestral API key has been removed');
        } catch (error) {
            void Logger.error('Error removing Codestral API key:', error as Error);
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

    static getCodestralModel(): string {
        return this.getConfig<string>('codestral', 'model', 'codestral-2405');
    }

    static getProvider(): string {
        const provider = this.getConfig<string>('provider', 'type', 'gemini');
        if (!['gemini', 'openai', 'codestral', 'ollama'].includes(provider)) {
            void Logger.warn(`Invalid provider type: ${provider}, falling back to gemini`);
            return 'gemini';
        }
        return provider;
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
            validateInput: ApiKeyValidator.validateGeminiApiKey
        });

        if (key) {
            await this.setApiKey(key);
        }
    }

    static async promptForCodestralApiKey(): Promise<void> {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Codestral API Key',
            ignoreFocusOut: true,
            password: true,
            validateInput: ApiKeyValidator.validateCodestralApiKey
        });

        if (key) {
            await this.setCodestralApiKey(key);
        }
    }

    static isTelemetryEnabled(): boolean {
        return this.getConfig<boolean>('telemetry', 'enabled', true);
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
        if (baseUrl !== withoutCompletions) { variants.push(withoutCompletions); }
        if (withoutCompletions !== withoutVersion) { variants.push(withoutVersion); }
        if (withoutVersion !== withoutApi) { variants.push(withoutApi); }

        if (!withoutApi.endsWith('/api')) {
            variants.push(`${withoutApi}/api`);
        }

        return [...new Set(variants)];
    }

    private static validateAndNormalizeEndpoint(endpoint: string): string {
        if (!endpoint) {
            return '';
        }

        let normalizedEndpoint = endpoint.trim();
        if (!normalizedEndpoint.startsWith('http://') && !normalizedEndpoint.startsWith('https://')) {
            normalizedEndpoint = `https://${normalizedEndpoint}`;
        }

        if (normalizedEndpoint.endsWith('/')) {
            normalizedEndpoint = normalizedEndpoint.slice(0, -1);
        }

        return normalizedEndpoint;
    }

    static async setOpenAIEndpoint(endpoint: string): Promise<void> {
        try {
            const normalizedEndpoint = await this.validateAndNormalizeEndpoint(endpoint);
            if (!normalizedEndpoint) {
                throw new ConfigurationError('Failed to validate endpoint');
            }

            const config = vscode.workspace.getConfiguration('commitSage');
            await config.update('openai.baseUrl', normalizedEndpoint, true);
            void Logger.log('OpenAI endpoint has been validated and set');
            await vscode.window.showInformationMessage('OpenAI endpoint has been successfully validated and saved');
        } catch (error) {
            void Logger.error('Failed to validate and set OpenAI endpoint:', error as Error);
            await vscode.window.showErrorMessage(`Failed to set OpenAI endpoint: ${(error as Error).message}`);
            throw error;
        }
    }

    static getOllamaBaseUrl(): string {
        return this.getConfig<string>('ollama', 'baseUrl', 'http://localhost:11434');
    }

    static getOllamaModel(): string {
        return this.getConfig<string>('ollama', 'model', 'mistral');
    }

    static async getOpenAIApiKey(): Promise<string> {
        try {
            let key = await this.secretStorage.get('commitsage.openaiApiKey');

            if (!key) {
                key = await vscode.window.showInputBox({
                    prompt: 'Enter your OpenAI API Key',
                    ignoreFocusOut: true,
                    password: true,
                    validateInput: ApiKeyValidator.validateOpenAIApiKey
                });

                if (!key) {
                    throw new ConfigurationError('OpenAI API key input was cancelled');
                }

                await this.setOpenAIApiKey(key);
            }

            return key;
        } catch (error) {
            void Logger.error('Error getting OpenAI API key:', error as Error);
            throw new AiServiceError('Failed to get OpenAI API key: ' + (error as Error).message);
        }
    }

    static async setOpenAIApiKey(key: string): Promise<void> {
        try {
            const validationError = ApiKeyValidator.validateOpenAIApiKey(key);
            if (validationError) {
                throw new AiServiceError(validationError);
            }

            await this.secretStorage.store('commitsage.openaiApiKey', key);
            await vscode.window.showInformationMessage('OpenAI API key has been successfully validated and saved');
        } catch (error) {
            void Logger.error('Failed to validate and set OpenAI API key:', error as Error);
            await vscode.window.showErrorMessage(`Failed to set API key: ${(error as Error).message}`);
            throw error;
        }
    }

    static async removeOpenAIApiKey(): Promise<void> {
        try {
            await this.secretStorage.delete('commitsage.openaiApiKey');
            void Logger.log('OpenAI API key has been removed');
            await vscode.window.showInformationMessage('OpenAI API key has been removed');
        } catch (error) {
            void Logger.error('Error removing OpenAI API key:', error as Error);
            throw error;
        }
    }

    static getOpenAIModel(): string {
        return this.getConfig<string>('openai', 'model', 'gpt-3.5-turbo');
    }

    static getOpenAIBaseUrl(): string {
        return this.getConfig<string>('openai', 'baseUrl', 'https://api.openai.com/v1');
    }

    static async promptForOpenAIApiKey(): Promise<void> {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your OpenAI API Key',
            ignoreFocusOut: true,
            password: true,
            validateInput: ApiKeyValidator.validateOpenAIApiKey
        });

        if (key) {
            await this.setOpenAIApiKey(key);
        }
    }
}
