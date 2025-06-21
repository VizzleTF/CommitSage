import * as vscode from 'vscode';
import { CommitMessageUI } from '../services/aiService';
import { Logger } from '../utils/logger';

export function registerGenerateCommitMessageCommand(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand(
        'commitsage.generateCommitMessage',
        async (sourceControlRepository?: vscode.SourceControl) => {
            try {
                await CommitMessageUI.generateAndSetCommitMessage(sourceControlRepository);
            } catch (error) {
                void Logger.error('Error in generateCommitMessage command:', error as Error);
                void vscode.window.showErrorMessage(`Error: ${(error as Error).message}`);
            }
        }
    );
} 