import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { Logger } from './utils/logger';
import { ConfigService } from './utils/configService';
import { GeminiCommitTreeDataProvider } from './views/geminiCommitTreeDataProvider';
import { generateAndSetCommitMessage } from './services/aiService';
import { SettingsValidator } from './services/settingsValidator';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    void Logger.log('Starting extension activation');

    await ConfigService.initialize(context);
    await Logger.initialize(context);

    try {
        void Logger.log('Validating Git extension');
        await GitService.validateGitExtension();
        await GitService.initialize(context);
    } catch (error) {
        void Logger.error('Failed to initialize Git extension:', error as Error);
        return;
    }

    void Logger.log('Registering commands and views');
    context.subscriptions.push(
        vscode.commands.registerCommand('geminicommit.generateCommitMessage', generateAndSetCommitMessage),
        vscode.commands.registerCommand('geminicommit.setApiKey', () => ConfigService.promptForApiKey()),
        vscode.commands.registerCommand('geminicommit.setCustomApiKey', () => ConfigService.promptForCustomApiKey()),
        vscode.commands.registerCommand('geminicommit.acceptInput', async () => {
            const message = GitService.getSourceControl().inputBox.value;
            if (message) {
                await GitService.commitChanges(GitService.getSourceControl(), message);
            }
        })
    );

    const treeDataProvider = new GeminiCommitTreeDataProvider();
    context.subscriptions.push(
        vscode.window.createTreeView('geminiCommitView', {
            treeDataProvider,
            showCollapseAll: false,
            canSelectMany: false
        })
    );

    void SettingsValidator.validateAllSettings();
    void Logger.log('Extension activated successfully');
}

export function deactivate(): void {
    void Logger.log('Deactivating extension');
    ConfigService.dispose();
    Logger.dispose();
    void Logger.log('Extension deactivated successfully');
}