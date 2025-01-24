import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { Logger } from './utils/logger';
import { ConfigService } from './utils/configService';
import { CommitMessageUI } from './services/aiService';
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
        void vscode.window.showErrorMessage(`Commit Sage initialization failed: ${(error as Error).message}`);
        return;
    }

    void Logger.log('Registering commands and views');
    try {
        const disposables = [
            vscode.commands.registerCommand('commitsage.generateCommitMessage', async (sourceControlRepository?: vscode.SourceControl) => {
                try {
                    await CommitMessageUI.generateAndSetCommitMessage(sourceControlRepository);
                } catch (error) {
                    void Logger.error('Error in generateCommitMessage command:', error as Error);
                    void vscode.window.showErrorMessage(`Error: ${(error as Error).message}`);
                }
            }),
            vscode.commands.registerCommand('commitsage.setApiKey', () => ConfigService.promptForApiKey()),
            vscode.commands.registerCommand('commitsage.setCustomApiKey', () => ConfigService.promptForCustomApiKey())
        ];

        context.subscriptions.push(...disposables);
    } catch (error) {
        void Logger.error('Failed to register commands:', error as Error);
        void vscode.window.showErrorMessage('Failed to register Commit Sage commands');
        return;
    }

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