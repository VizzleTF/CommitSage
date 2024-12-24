import * as vscode from 'vscode';
import { Logger } from './logger';

export class ConfigService {
    private static cache = new Map<string, any>();
    private static secretStorage: vscode.SecretStorage;
    private static configurationListener: vscode.Disposable;

    static initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;

        this.configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('geminiCommit')) {
                this.clearCache();
                Logger.log('Configuration changed, cache cleared');
            }
        });

        context.subscriptions.push(this.configurationListener);
    }

    static getConfig<T>(section: string, key: string, defaultValue: T): T {
        const cacheKey = `${section}.${key}`;
        if (!this.cache.has(cacheKey)) {
            const value = vscode.workspace.getConfiguration('geminiCommit').get<T>(`${section}.${key}`) ?? defaultValue;
            this.cache.set(cacheKey, value);
        }
        return this.cache.get(cacheKey);
    }

    static async getApiKey(): Promise<string> {
        let key = await this.secretStorage.get('geminicommit.apiKey');
        if (!key) {
            key = await vscode.window.showInputBox({
                prompt: 'Enter your Google API Key',
                ignoreFocusOut: true,
                password: true
            });
            if (!key) {
                throw new Error('API key is not set');
            }
            await this.setApiKey(key);
        }
        return key;
    }

    static async setApiKey(key: string): Promise<void> {
        await this.secretStorage.store('geminicommit.apiKey', key);
        Logger.log('API key has been set');
    }

    static async getCustomApiKey(): Promise<string> {
        let key = await this.secretStorage.get('geminicommit.customApiKey');
        if (!key) {
            key = await vscode.window.showInputBox({
                prompt: 'Enter your Custom API Key',
                ignoreFocusOut: true,
                password: true
            });
            if (!key) {
                throw new Error('Custom API key is not set');
            }
            await this.setCustomApiKey(key);
        }
        return key;
    }

    static async setCustomApiKey(key: string): Promise<void> {
        await this.secretStorage.store('geminicommit.customApiKey', key);
        Logger.log('Custom API key has been set');
    }

    static getGeminiModel(): string {
        return this.getConfig<string>('gemini', 'model', 'gemini-1.5-flash');
    }

    static getCommitLanguage(): string {
        return this.getConfig<string>('commit', 'commitLanguage', 'english');
    }

    static getCommitMessageLength(): string {
        return this.getConfig<string>('commit', 'commitMessageLength', 'long');
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

    static clearCache(): void {
        this.cache.clear();
        Logger.log('Configuration cache cleared');
    }

    static shouldPromptForRefs(): boolean {
        return this.getConfig<boolean>('commit', 'promptForRefs', false);
    }

    static getOnlyStagedChanges(): boolean {
        return this.getConfig<boolean>('commit', 'onlyStagedChanges', false);
    }
}