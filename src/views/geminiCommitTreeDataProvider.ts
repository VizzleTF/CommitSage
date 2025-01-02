import * as vscode from 'vscode';

export class GeminiCommitTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem = (element: vscode.TreeItem): vscode.TreeItem => element;

    getChildren = (element?: vscode.TreeItem): Promise<vscode.TreeItem[]> => {
        if (element) {
            return Promise.resolve([]);
        }
        const generateButton = new vscode.TreeItem("Generate Commit Message");
        generateButton.command = {
            command: 'geminicommit.generateCommitMessage',
            title: 'GeminiCommit: Generate Message'
        };
        return Promise.resolve([generateButton]);
    };
}