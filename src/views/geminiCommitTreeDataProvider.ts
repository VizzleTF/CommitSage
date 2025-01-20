import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export class GeminiCommitTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(_element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        void Logger.log('Building tree view items');
        const generateButton = new vscode.TreeItem(
            "Generate Commit Message",
            vscode.TreeItemCollapsibleState.None
        );

        generateButton.command = {
            command: 'geminicommit.generateCommitMessage',
            title: 'Generate Commit Message',
            tooltip: 'Generate a commit message using AI'
        };

        generateButton.contextValue = 'generateCommitMessage';
        generateButton.iconPath = new vscode.ThemeIcon('git-commit');

        void Logger.log('Tree view items built successfully');
        return [generateButton];
    }

    refresh(): void {
        void Logger.log('Refreshing tree view');
        this._onDidChangeTreeData.fire(undefined);
    }
}