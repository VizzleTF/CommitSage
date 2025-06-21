import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';

export function registerSetApiKeyCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('commitsage.setApiKey', () =>
            ConfigService.promptForApiKey()
        ),
        vscode.commands.registerCommand('commitsage.setOpenAIApiKey', () =>
            ConfigService.promptForOpenAIApiKey()
        ),
        vscode.commands.registerCommand('commitsage.setCodestralApiKey', () =>
            ConfigService.promptForCodestralApiKey()
        )
    ];
} 