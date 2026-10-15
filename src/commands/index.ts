import * as vscode from 'vscode';
import { registerSetApiKeyCommands } from './setApiKeys';
import { createProjectConfig } from './createProjectConfig';
import { registerSelectGeminiModelCommand } from './selectGeminiModel';
import { registerOpenRouterAuthCommands } from './openRouterAuth';
import { CommitWorkflow } from '../services/commitWorkflow';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

export function registerCommands(context: vscode.ExtensionContext): void {
    Logger.log('Registering commands and views');

    try {
        const disposables = [
            // generateAndSetCommitMessage handles and reports its own errors.
            vscode.commands.registerCommand(
                'commitsage.generateCommitMessage',
                (repository?: vscode.SourceControl) => CommitWorkflow.generateAndSetCommitMessage(repository),
            ),
            ...registerSetApiKeyCommands(),
            registerSelectGeminiModelCommand(),
            ...registerOpenRouterAuthCommands(context),
            vscode.commands.registerCommand('commitsage.createProjectConfig', createProjectConfig)
        ];

        context.subscriptions.push(...disposables);
    } catch (error) {
        Logger.error('Failed to register commands:', toError(error));
        void Logger.showError(vscode.l10n.t('Failed to register commands'));
        throw error;
    }
}