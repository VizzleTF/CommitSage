import * as vscode from 'vscode';
import { Logger } from './logger';

export class ConfigService {
    private static cache = new Map<string, any>();
    private static secretStorage: vscode.SecretStorage;

    static initialize(context: vscode.ExtensionContext): void {
        this.secretStorage = context.secrets;
    }

    static getConfig<T>(key: string, defaultValue: T): T {
        if (!this.cache.has(key)) {
            const value = vscode.workspace.getConfiguration('geminiCommit').get<T>(key) ?? defaultValue;
            this.cache.set(key, value);
        }
        return this.cache.get(key);
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
        return this.getConfig<string>('geminiModel', 'gemini-1.5-flash');
    }

    static getCommitLanguage(): string {
        return this.getConfig<string>('commitLanguage', 'english');
    }

    static getCommitMessageLength(): string {
        return this.getConfig<string>('commitMessageLength', 'long');
    }

    static getCustomInstructions(): string {
        return this.getConfig<string>('customInstructions', '');
    }

    static useCustomEndpoint(): boolean {
        return this.getConfig<boolean>('useCustomEndpoint', false);
    }

    static getCustomEndpoint(): string {
        return this.getConfig<string>('customEndpoint', '');
    }

    static getCustomModel(): string {
        return this.getConfig<string>('customModel', '');
    }

    static clearCache(): void {
        this.cache.clear();
        Logger.log('Configuration cache cleared');
    }

    static shouldPromptForRefs(): boolean {
        return this.getConfig<boolean>('promptForRefs', false);
    }
}