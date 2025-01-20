import * as vscode from 'vscode';

export class GeminiCommitTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(_element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        const generateButton = new vscode.TreeItem(
            "Generate Commit Message",
            vscode.TreeItemCollapsibleState.None
        );

        generateButton.command = {
            command: 'geminicommit.generateCommitMessage',
            title: 'Generate Commit Message',
            tooltip: 'Generate a commit message using AI'
        };

        generateButton.iconPath = new vscode.ThemeIcon('git-commit');

        return [generateButton];
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
}