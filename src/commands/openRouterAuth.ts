import * as vscode from 'vscode';
import { OpenRouterAuthService } from '../services/openRouterAuthService';

/**
 * Registers the OpenRouter OAuth login command and the global URI handler that
 * catches the `vscode://` redirect once the user authorizes in the browser.
 */
export function registerOpenRouterAuthCommands(
    context: vscode.ExtensionContext,
): vscode.Disposable[] {
    return [
        OpenRouterAuthService.register(),
        vscode.commands.registerCommand('commitsage.loginOpenRouter', () =>
            OpenRouterAuthService.login(context),
        ),
    ];
}
