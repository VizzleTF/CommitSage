import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { Logger } from './utils/logger';
import { ConfigService } from './utils/configService';
import { GeminiCommitTreeDataProvider } from './views/geminiCommitTreeDataProvider';
import { generateAndSetCommitMessage } from './services/aiService';
import { SettingsValidator } from './services/settingsValidator';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    await ConfigService.initialize(context);
    await Logger.initialize(context);

    try {
        await GitService.validateGitExtension();
        await GitService.initialize(context);
    } catch (error) {
        void Logger.error('Failed to initialize Git extension:', error as Error);
        return;
    }

    const commands = [
        vscode.commands.registerCommand('geminicommit.generateCommitMessage', generateAndSetCommitMessage),
        vscode.commands.registerCommand('geminicommit.setApiKey', () => ConfigService.promptForApiKey()),
        vscode.commands.registerCommand('geminicommit.setCustomApiKey', () => ConfigService.promptForCustomApiKey())
    ];

    const treeDataProvider = new GeminiCommitTreeDataProvider();
    const treeView = vscode.window.createTreeView('geminiCommitView', {
        treeDataProvider,
        showCollapseAll: false
    });

    context.subscriptions.push(...commands, treeView);

    void SettingsValidator.validateAllSettings();

    void Logger.log('GeminiCommit extension activated');
}

export function deactivate(): void {
    void Logger.log('GeminiCommit extension deactivated');
    ConfigService.dispose();
    Logger.dispose();
}