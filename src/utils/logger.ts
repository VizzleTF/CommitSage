import * as vscode from 'vscode';

export class Logger {
    private static channel: vscode.LogOutputChannel | null = null;

    static initialize(): void {
        this.channel = vscode.window.createOutputChannel('Commit Sage', { log: true });
        this.channel.info('Logger initialized');
    }

    static log(message: string): void {
        this.channel?.info(message);
    }

    static warn(message: string): void {
        this.channel?.warn(message);
    }

    static error(message: string, error?: Error): void {
        if (!this.channel) { return; }
        if (error) {
            this.channel.error(message, error);
        } else {
            this.channel.error(message);
        }
    }

    static async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showErrorMessage(`Commit Sage: ${message}`, ...actions);
    }

    static async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showWarningMessage(`Commit Sage: ${message}`, ...actions);
    }

    static async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showInformationMessage(`Commit Sage: ${message}`, ...actions);
    }

    static dispose(): void {
        this.channel?.dispose();
        this.channel = null;
    }
}
