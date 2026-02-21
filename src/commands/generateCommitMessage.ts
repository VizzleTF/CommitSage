import * as vscode from 'vscode';
import { CommitWorkflow } from '../services/commitWorkflow';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

export function registerGenerateCommitMessageCommand(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand(
        'commitsage.generateCommitMessage',
        async (sourceControlRepository?: vscode.SourceControl) => {
            try {
                await CommitWorkflow.generateAndSetCommitMessage(sourceControlRepository);
            } catch (error) {
                Logger.error('Error in generateCommitMessage command:', toError(error));
                void Logger.showError(toError(error).message);
            }
        }
    );
}