import * as vscode from 'vscode';

export class Logger {
    private static readonly outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('Commit Sage');

    static async initialize(_context: vscode.ExtensionContext): Promise<void> {
        this.log('Logger initialized');
    }

    static log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [INFO] ${message}`);
    }

    static async error(message: string, error?: Error): Promise<void> {
        const timestamp = new Date().toISOString();
        const errorMessage = error ? `: ${error.message}\n${error.stack}` : '';
        this.outputChannel.appendLine(`[${timestamp}] [ERROR] ${message}${errorMessage}`);

        await vscode.window.showErrorMessage(
            `Commit Sage: ${message}`,
            { modal: false },
            'Show Details',
            'OK'
        ).then(selection => {
            if (selection === 'Show Details') {
                this.show();
            }
        });
    }

    static warn(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [WARN] ${message}`);
    }

    static show(): void {
        this.outputChannel.show();
    }

    static dispose(): void {
        this.outputChannel.dispose();
    }

    public static showError(message: string, error?: Error): void {
        this.error(message, error);
        void vscode.window.showErrorMessage(
            `Commit Sage: ${message}`,
            { modal: false }
        );
    }
}