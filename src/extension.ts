import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './gitService';
import { AIService } from './aiService';
import { Logger } from './logger';
import { ConfigService } from './configService';
import { analyzeFileChanges } from './gitBlameAnalyzer';
import { MESSAGES, ERROR_MESSAGES } from './constants';
import { CommitMessage, ProgressReporter } from './types';
import { NoRepositorySelectedError } from './errors';

const EXTENSION_NAME = 'GeminiCommit';
const COMMAND_ID = 'geminicommit.generateCommitMessage';
const VIEW_ID = 'geminiCommitView';

const generateAndSetCommitMessage = async () => {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Generating Commit Message",
        cancellable: false
    }, async (progress: ProgressReporter) => {
        try {
            const repos = await GitService.getRepositories();
            const selectedRepo = await GitService.selectRepository(repos);

            if (!selectedRepo || !selectedRepo.rootUri) {
                throw new NoRepositorySelectedError();
            }

            progress.report({ message: MESSAGES.FETCHING_DIFF, increment: 0 });
            const diff = await GitService.getDiff(selectedRepo.rootUri.fsPath);
            Logger.log(`Git diff fetched successfully. Length: ${diff.length} characters`);

            progress.report({ message: MESSAGES.ANALYZING_CHANGES, increment: 25 });
            const changedFiles = await GitService.getChangedFiles(selectedRepo.rootUri.fsPath);
            let blameAnalysis = await analyzeChanges(selectedRepo.rootUri.fsPath, changedFiles);

            progress.report({ message: MESSAGES.GENERATING, increment: 50 });
            const { message: commitMessage, model } = await AIService.generateCommitMessage(diff, blameAnalysis, progress);
            Logger.log('Commit message generated successfully');

            let finalMessage = commitMessage;

            if (ConfigService.shouldPromptForRefs()) {
                const refs = await vscode.window.showInputBox({
                    prompt: "Enter references (e.g., issue numbers) to be added below the commit message",
                    placeHolder: "e.g., #123, JIRA-456"
                });

                if (refs) {
                    finalMessage += `\n\n${refs}`;
                }
            }

            progress.report({ message: MESSAGES.SETTING_MESSAGE, increment: 75 });
            selectedRepo.inputBox.value = finalMessage;
            Logger.log('Commit message set successfully');

            progress.report({ message: MESSAGES.DONE, increment: 100 });
            vscode.window.showInformationMessage(MESSAGES.SUCCESS.replace('{0}', model));
        } catch (error) {
            Logger.error(ERROR_MESSAGES.COMMAND_EXECUTION, error as Error);
            vscode.window.showErrorMessage(`${ERROR_MESSAGES.GENERATE_COMMIT_MESSAGE}: ${(error as Error).message}`);
        }
    });
};

const analyzeChanges = async (repoPath: string, changedFiles: string[]): Promise<string> => {
    let blameAnalysis = '';
    for (const file of changedFiles) {
        const filePath = vscode.Uri.file(path.join(repoPath, file));
        try {
            const fileBlameAnalysis = await analyzeFileChanges(filePath.fsPath);
            blameAnalysis += `File: ${file}\n${fileBlameAnalysis}\n\n`;
        } catch (error) {
            Logger.error(`Error analyzing file ${file}:`, error as Error);
            blameAnalysis += `File: ${file}\nUnable to analyze: ${(error as Error).message}\n\n`;
        }
    }
    return blameAnalysis;
};

class GeminiCommitTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem = (element: vscode.TreeItem): vscode.TreeItem => element;

    getChildren = (element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> => {
        if (element) return Promise.resolve([]);
        const generateButton = new vscode.TreeItem("Generate Commit Message");
        generateButton.command = {
            command: COMMAND_ID,
            title: `${EXTENSION_NAME}: Generate Message`
        };
        return Promise.resolve([generateButton]);
    };
}

export const activate = (context: vscode.ExtensionContext): void => {
    Logger.log(`${EXTENSION_NAME} extension is now active!`);

    ConfigService.initialize(context);

    const generateCommitMessageCommand = vscode.commands.registerCommand(COMMAND_ID, generateAndSetCommitMessage);

    const treeDataProvider = new GeminiCommitTreeDataProvider();
    const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider });

    context.subscriptions.push(generateCommitMessageCommand, treeView);

    registerApiKeyCommands(context);
};

const registerApiKeyCommands = (context: vscode.ExtensionContext): void => {
    const setApiKeyCommand = vscode.commands.registerCommand('geminicommit.setApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Google API Key',
            ignoreFocusOut: true,
            password: true
        });
        if (key) {
            await ConfigService.setApiKey(key);
            vscode.window.showInformationMessage('API key has been set successfully.');
        }
    });

    const setCustomApiKeyCommand = vscode.commands.registerCommand('geminicommit.setCustomApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Custom API Key',
            ignoreFocusOut: true,
            password: true
        });
        if (key) {
            await ConfigService.setCustomApiKey(key);
            vscode.window.showInformationMessage('Custom API key has been set successfully.');
        }
    });

    context.subscriptions.push(setApiKeyCommand, setCustomApiKeyCommand);
};

export const deactivate = (): void => {
    Logger.log(`${EXTENSION_NAME} extension is now deactivated.`);
    ConfigService.clearCache();
};