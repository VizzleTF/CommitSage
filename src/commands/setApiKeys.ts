import * as vscode from 'vscode';
import { ApiKeyManager } from '../services/apiKeyManager';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

export function registerSetApiKeyCommands(_context: vscode.ExtensionContext): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('commitsage.setApiKey', () =>
            ApiKeyManager.promptForKey('gemini')
        ),
        vscode.commands.registerCommand('commitsage.setOpenAIApiKey', () =>
            ApiKeyManager.promptForKey('openai')
        ),
        vscode.commands.registerCommand('commitsage.setCodestralApiKey', () =>
            ApiKeyManager.promptForKey('codestral')
        ),
        vscode.commands.registerCommand('commitsage.removeApiKey', async () => {
            try {
                await ApiKeyManager.removeKey('gemini');
                await Logger.showInfo('Gemini API key has been removed');
            } catch (error) {
                Logger.error('Error removing Gemini API key:', toError(error));
                await Logger.showError(`Failed to remove API key: ${(toError(error)).message}`);
            }
        }),
        vscode.commands.registerCommand('commitsage.removeOpenAIApiKey', async () => {
            try {
                await ApiKeyManager.removeKey('openai');
                await Logger.showInfo('OpenAI API key has been removed');
            } catch (error) {
                Logger.error('Error removing OpenAI API key:', toError(error));
                await Logger.showError(`Failed to remove API key: ${(toError(error)).message}`);
            }
        }),
        vscode.commands.registerCommand('commitsage.removeCodestralApiKey', async () => {
            try {
                await ApiKeyManager.removeKey('codestral');
                await Logger.showInfo('Codestral API key has been removed');
            } catch (error) {
                Logger.error('Error removing Codestral API key:', toError(error));
                await Logger.showError(`Failed to remove API key: ${(toError(error)).message}`);
            }
        })
    ];
}
