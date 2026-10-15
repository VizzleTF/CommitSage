import * as vscode from 'vscode';
import { registerSetApiKeyCommands } from './setApiKeys';
import { createProjectConfig } from './createProjectConfig';
import { registerSelectGeminiModelCommand } from './selectGeminiModel';
import { registerOpenRouterAuthCommands } from './openRouterAuth';
import { CommitWorkflow } from '../services/commitWorkflow';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

/**
 * @param ready settles when activation finishes its async setup; generation
 *   reads the project config and the git extension, so it waits for it.
 */
export function registerCommands(context: vscode.ExtensionContext, ready: Promise<unknown>): void {
    Logger.log('Registering commands and views');

    // generateAndSetCommitMessage handles and reports its own errors.
    const generate = async (repository?: vscode.SourceControl): Promise<void> => {
        await ready;
        return CommitWorkflow.generateAndSetCommitMessage(repository);
    };

    try {
        const disposables = [
            vscode.commands.registerCommand('commitsage.generateCommitMessage', generate),
            // The spinner that replaces the SCM button during a run; a click
            // lands in the per-repository guard, which says a run is active.
            vscode.commands.registerCommand('commitsage.generatingCommitMessage', generate),
            ...registerSetApiKeyCommands(),
            registerSelectGeminiModelCommand(),
            ...registerOpenRouterAuthCommands(context),
            vscode.commands.registerCommand('commitsage.createProjectConfig', createProjectConfig),
            vscode.commands.registerCommand('commitsage.splitCommits', async (repository?: vscode.SourceControl) => {
                await ready;
                return CommitWorkflow.splitAndCommit(repository);
            }),
        ];

        context.subscriptions.push(...disposables);
    } catch (error) {
        Logger.error('Failed to register commands:', toError(error));
        void Logger.showError(vscode.l10n.t('Failed to register commands'));
        throw error;
    }
}