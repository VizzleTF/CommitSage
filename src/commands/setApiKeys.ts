import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';

export function registerSetApiKeyCommands(_context: vscode.ExtensionContext): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('commitsage.setApiKey', () =>
            ConfigService.promptForApiKey()
        ),
        vscode.commands.registerCommand('commitsage.setOpenAIApiKey', () =>
            ConfigService.promptForOpenAIApiKey()
        ),
        vscode.commands.registerCommand('commitsage.setCodestralApiKey', () =>
            ConfigService.promptForCodestralApiKey()
        ),
        vscode.commands.registerCommand('commitsage.removeApiKey', async () => {
            try {
                await ConfigService.removeApiKey();
                await Logger.showInfo('Gemini API key has been removed');
            } catch (error) {
                void Logger.error('Error removing Gemini API key:', error as Error);
                await Logger.showError(`Failed to remove API key: ${(error as Error).message}`);
            }
        }),
        vscode.commands.registerCommand('commitsage.removeOpenAIApiKey', async () => {
            try {
                await ConfigService.removeOpenAIApiKey();
                await Logger.showInfo('OpenAI API key has been removed');
            } catch (error) {
                void Logger.error('Error removing OpenAI API key:', error as Error);
                await Logger.showError(`Failed to remove API key: ${(error as Error).message}`);
            }
        }),
        vscode.commands.registerCommand('commitsage.removeCodestralApiKey', async () => {
            try {
                await ConfigService.removeCodestralApiKey();
                await Logger.showInfo('Codestral API key has been removed');
            } catch (error) {
                void Logger.error('Error removing Codestral API key:', error as Error);
                await Logger.showError(`Failed to remove API key: ${(error as Error).message}`);
            }
        })
    ];
}