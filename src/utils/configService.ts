import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { ApiKeyValidator } from './apiKeyValidator';
import { AiServiceError, ConfigurationError } from '../models/errors';
import { ProjectConfig } from '../models/types';

type CacheValue = string | boolean | number;

export type CommitLanguage = 'english' | 'russian' | 'chinese' | 'japanese' | 'spanish';

export class ConfigService {
    private static cache = new Map<string, CacheValue>();
    private static projectConfigCache: ProjectConfig | null = null;
    private static projectConfigFileWatcher: vscode.FileSystemWatcher | null = null;
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

        // Инициализируем наблюдение за файлом .commitsage
        this.initializeProjectConfigWatcher(context);

        this.disposables.push(configListener);
        context.subscriptions.push(...this.disposables);
    }

    private static initializeProjectConfigWatcher(context: vscode.ExtensionContext): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const pattern = new vscode.RelativePattern(workspaceFolder, '.commitsage');
        this.projectConfigFileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.projectConfigFileWatcher.onDidCreate(() => {
            this.invalidateProjectConfig();
        });

        this.projectConfigFileWatcher.onDidChange(() => {
            this.invalidateProjectConfig();
        });

        this.projectConfigFileWatcher.onDidDelete(() => {
            this.invalidateProjectConfig();
        });

        this.disposables.push(this.projectConfigFileWatcher);
        context.subscriptions.push(this.projectConfigFileWatcher);
    }

    private static invalidateProjectConfig(): void {
        this.projectConfigCache = null;
        this.clearCache();
        void Logger.log('Project configuration cache invalidated');
    }

    private static getProjectConfig(): ProjectConfig | null {
        if (this.projectConfigCache !== null) {
            return this.projectConfigCache;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            this.projectConfigCache = {};
            return this.projectConfigCache;
        }

        const configPath = path.join(workspaceFolder.uri.fsPath, '.commitsage');

        try {
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(configContent) as ProjectConfig;
                this.projectConfigCache = config;
                void Logger.log('Loaded project configuration from .commitsage file');
            } else {
                this.projectConfigCache = {};
            }
        } catch (error) {
            void Logger.error('Error reading .commitsage file:', error as Error);
            this.projectConfigCache = {};
        }

        return this.projectConfigCache;
    }

    private static getNestedProjectValue<T>(sections: string[], _defaultValue: T): T | undefined {
        const projectConfig = this.getProjectConfig();
        if (!projectConfig) {
            return undefined;
        }

        let current: Record<string, unknown> = projectConfig as Record<string, unknown>;
        for (const section of sections) {
            if (current && typeof current === 'object' && section in current) {
                current = current[section] as Record<string, unknown>;
            } else {
                return undefined;
            }
        }

        return current as T;
    }

    static getConfig<T extends CacheValue>(section: string, key: string, defaultValue: T): T {
        try {
            const cacheKey = `${section}.${key}`;
            if (!this.cache.has(cacheKey)) {
                // Сначала проверяем настройки проекта
                const projectValue = this.getNestedProjectValue<T>([section, key], defaultValue);

                if (projectValue !== undefined) {
                    this.cache.set(cacheKey, projectValue);
                    return projectValue;
                }

                // Если в проекте нет настройки, используем настройки расширения
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
            void Logger.log('Google API key has been validated and set');
        } catch (error) {
            void Logger.error('Failed to validate and set Google API key:', error as Error);
            await Logger.showError(`Failed to set API key: ${(error as Error).message}`);
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
        } catch (error) {
            void Logger.error('Failed to validate and set Codestral API key:', error as Error);
            await Logger.showError(`Failed to set API key: ${(error as Error).message}`);
            throw error;
        }
    }

    static async removeApiKey(): Promise<void> {
        try {
            await this.secretStorage.delete('commitsage.apiKey');
            void Logger.log('Google API key has been removed');
        } catch (error) {
            void Logger.error('Error removing Google API key:', error as Error);
            throw error;
        }
    }

    static async removeCodestralApiKey(): Promise<void> {
        try {
            await this.secretStorage.delete('commitsage.codestralApiKey');
            void Logger.log('Codestral API key has been removed');
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


    static clearCache(): void {
        this.cache.clear();
    }

    static dispose(): void {
        this.disposables.forEach(d => void d.dispose());
        this.disposables = [];
        this.clearCache();
        this.projectConfigCache = null;
        if (this.projectConfigFileWatcher) {
            this.projectConfigFileWatcher.dispose();
            this.projectConfigFileWatcher = null;
        }
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
        } catch (error) {
            void Logger.error('Failed to validate and set OpenAI endpoint:', error as Error);
            await Logger.showError(`Failed to set OpenAI endpoint: ${(error as Error).message}`);
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
            void Logger.log('OpenAI API key has been validated and set');
        } catch (error) {
            void Logger.error('Failed to validate and set OpenAI API key:', error as Error);
            await Logger.showError(`Failed to set API key: ${(error as Error).message}`);
            throw error;
        }
    }

    static async removeOpenAIApiKey(): Promise<void> {
        try {
            await this.secretStorage.delete('commitsage.openaiApiKey');
            void Logger.log('OpenAI API key has been removed');
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

    static getApiRequestTimeout(): number {
        return this.getConfig<number>('', 'apiRequestTimeout', 30);
    }
}
