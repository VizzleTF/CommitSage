import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { Logger } from './utils/logger';
import { ConfigService } from './utils/configService';
import { GeminiCommitTreeDataProvider } from './views/geminiCommitTreeDataProvider';
import { generateAndSetCommitMessage } from './services/aiService';
import { SettingsValidator } from './services/settingsValidator';
import { TelemetryService } from './services/telemetryService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    void Logger.log('Starting extension activation');

    try {
        await ConfigService.initialize(context);
        await Logger.initialize(context);
        await TelemetryService.initialize(context);

        void Logger.log('Validating Git extension');
        await GitService.validateGitExtension();
        await GitService.initialize(context);
    } catch (error) {
        void Logger.error('Failed during initialization:', error as Error);
        void vscode.window.showErrorMessage(`GeminiCommit initialization failed: ${(error as Error).message}`);
        return;
    }

    void Logger.log('Registering commands and views');
    try {
        context.subscriptions.push(
            vscode.commands.registerCommand('geminicommit.generateCommitMessage', async () => {
                try {
                    await generateAndSetCommitMessage();
                } catch (error) {
                    void Logger.error('Error in generateCommitMessage command:', error as Error);
                    void vscode.window.showErrorMessage(`Error: ${(error as Error).message}`);
                }
            }),
            vscode.commands.registerCommand('geminicommit.setApiKey', () => ConfigService.promptForApiKey()),
            vscode.commands.registerCommand('geminicommit.setCustomApiKey', () => ConfigService.promptForCustomApiKey()),
            vscode.commands.registerCommand('geminicommit.acceptInput', async () => {
                try {
                    const message = await vscode.window.showInputBox({
                        prompt: 'Enter commit message',
                        placeHolder: 'Type your commit message'
                    });
                    if (message) {
                        await GitService.commitChanges(message);
                    }
                } catch (error) {
                    void Logger.error('Error in commit command:', error as Error);
                    void vscode.window.showErrorMessage(`Error: ${(error as Error).message}`);
                }
            }),
            vscode.commands.registerCommand('geminicommit.pushChanges', async () => {
                try {
                    await GitService.pushChanges();
                    void vscode.window.showInformationMessage('Successfully pushed changes to remote');
                } catch (error) {
                    void Logger.error('Error pushing changes:', error as Error);
                    void vscode.window.showErrorMessage(`Failed to push changes: ${(error as Error).message}`);
                }
            })
        );
    } catch (error) {
        void Logger.error('Failed to register commands:', error as Error);
        void vscode.window.showErrorMessage('Failed to register GeminiCommit commands');
        return;
    }

    const treeDataProvider = new GeminiCommitTreeDataProvider();
    context.subscriptions.push(
        vscode.window.createTreeView('geminiCommitView', {
            treeDataProvider,
            showCollapseAll: false,
            canSelectMany: false
        })
    );

    void SettingsValidator.validateAllSettings();
    void TelemetryService.sendEvent('extension_activated');
    void Logger.log('Extension activated successfully');
}

export function deactivate(): void {
    void Logger.log('Deactivating extension');
    ConfigService.dispose();
    Logger.dispose();
    TelemetryService.dispose();
    void Logger.log('Extension deactivated successfully');
}