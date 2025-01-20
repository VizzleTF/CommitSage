import * as vscode from 'vscode';

export class Logger {
    private static readonly outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('GeminiCommit');

    static async initialize(_context: vscode.ExtensionContext): Promise<void> {
        this.log('Logger initialized');
    }

    static log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    static async error(message: string, error?: Error): Promise<void> {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ERROR: ${message}`);
        if (error) {
            this.outputChannel.appendLine(`Stack trace: ${error.stack}`);
        }

        await vscode.window.showErrorMessage(
            `GeminiCommit: ${message}`,
            { modal: false },
            'Show Details',
            'OK'
        ).then(selection => {
            if (selection === 'Show Details') {
                this.show();
            }
        });
    }

    static show(): void {
        this.outputChannel.show();
    }

    static clear(): void {
        this.outputChannel.clear();
    }

    static dispose(): void {
        this.outputChannel.dispose();
    }
}