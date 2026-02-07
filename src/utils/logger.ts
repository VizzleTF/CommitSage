import * as vscode from 'vscode';

export class Logger {
    private static outputChannel: vscode.OutputChannel | null = null;

    static initialize(): void {
        this.outputChannel = vscode.window.createOutputChannel('Commit Sage');
        this.log('Logger initialized');
    }

    static log(message: string): void {
        if (!this.outputChannel) { return; }
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [INFO] ${message}`);
    }

    static error(message: string, error?: Error): void {
        if (!this.outputChannel) { return; }
        const timestamp = new Date().toISOString();
        const errorMessage = error ? `: ${error.message}\n${error.stack}` : '';
        this.outputChannel.appendLine(`[${timestamp}] [ERROR] ${message}${errorMessage}`);
    }

    static warn(message: string): void {
        if (!this.outputChannel) { return; }
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [WARN] ${message}`);
    }

    static async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        const selection = await vscode.window.showErrorMessage(
            `Commit Sage: ${message}`,
            ...actions
        );

        if (selection === 'Show Details') {
            this.show();
        }

        return selection;
    }

    static async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showWarningMessage(
            `Commit Sage: ${message}`,
            ...actions
        );
    }

    static async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showInformationMessage(
            `Commit Sage: ${message}`,
            ...actions
        );
    }

    static show(): void {
        this.outputChannel?.show();
    }

    static dispose(): void {
        this.outputChannel?.dispose();
        this.outputChannel = null;
    }
}
