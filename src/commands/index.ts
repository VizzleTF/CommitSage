import * as vscode from 'vscode';
import { registerGenerateCommitMessageCommand } from './generateCommitMessage';
import { registerSetApiKeyCommands } from './setApiKeys';
import { Logger } from '../utils/logger';

export function registerCommands(context: vscode.ExtensionContext): void {
    void Logger.log('Registering commands and views');

    try {
        const disposables = [
            registerGenerateCommitMessageCommand(context),
            ...registerSetApiKeyCommands(context)
        ];

        context.subscriptions.push(...disposables);
    } catch (error) {
        void Logger.error('Failed to register commands:', error as Error);
        void vscode.window.showErrorMessage('Failed to register Commit Sage commands');
        throw error;
    }
} 