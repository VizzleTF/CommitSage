import * as vscode from 'vscode';
import * as child_process from 'child_process';
import axios from 'axios';

function log(message: string) {
    console.log(`[AutoCommit] ${message}`);
}

function logError(message: string) {
    console.error(`[AutoCommit] ${message}`);
    vscode.window.showErrorMessage(message);
}

export function activate(context: vscode.ExtensionContext) {
    log('AutoCommit extension is now active!');

    const generateCommitMessageCommand = vscode.commands.registerCommand('extension.generateCommitMessage', generateAndSetCommitMessage);

    const treeDataProvider = new AutoCommitTreeDataProvider();
    const treeView = vscode.window.createTreeView('autoCommitView', { treeDataProvider });

    context.subscriptions.push(generateCommitMessageCommand, treeView);
}

class AutoCommitTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            const generateButton = new vscode.TreeItem("Generate Commit Message");
            generateButton.command = {
                command: 'extension.generateCommitMessage',
                title: 'Generate Commit Message'
            };
            return Promise.resolve([generateButton]);
        }
    }
}

async function generateAndSetCommitMessage() {
    try {
        log('Fetching Git status and diff...');
        const { status, diff } = await getGitInfo();
        log('Git info fetched successfully');

        log('Generating commit message...');
        const commitMessage = await generateCommitMessage(status, diff);
        log('Commit message generated successfully');

        log('Setting commit message in Source Control view...');
        await setCommitMessage(commitMessage);
        log('Commit message set successfully');
    } catch (error) {
        logError(`Error in command execution: ${error}`);
    }
}

async function getGitInfo(): Promise<{ status: string; diff: string }> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        throw new Error('No workspace folder open');
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    log(`Workspace root path: ${rootPath}`);

    const execPromise = (command: string) => new Promise<string>((resolve, reject) => {
        child_process.exec(command, { cwd: rootPath }, (error, stdout, stderr) => {
            if (error) {
                reject(`Error executing ${command}: ${error.message}`);
                return;
            }
            if (stderr) {
                reject(`Git error: ${stderr}`);
                return;
            }
            resolve(stdout);
        });
    });

    const [status, diff] = await Promise.all([
        execPromise('git status'),
        execPromise('git diff --cached')
    ]);

    return { status, diff };
}

async function generateCommitMessage(status: string, diff: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('autoCommit');
    const apiKey = config.get<string>('googleApiKey');

    if (!apiKey) {
        throw new Error('Google API key is not set. Please set it in the extension settings.');
    }

    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";
    log(`Calling Google AI API at: ${url}`);

    const prompt = `Generate a concise and informative Git commit message based on the following git status and diff output. The commit message should follow this format:
- First line: A brief summary of changes (max 72 characters)
- Second line: Blank
- Subsequent lines: More detailed explanation if necessary (each line max 72 characters)

Avoid excessive newlines and keep the message compact.

Git status:
${status}

Git diff:
${diff}
`;

    const payload = {
        contents: [
            {
                parts: [
                    { text: prompt }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
        },
    };

    const headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
    };

    try {
        const response = await axios.post(url, payload, { headers });
        return cleanCommitMessage(response.data.candidates[0].content.parts[0].text);
    } catch (error) {
        throw new Error(`Error calling Google AI API: ${error}`);
    }
}

function cleanCommitMessage(message: string): string {
    // Remove any surrounding quotes
    message = message.replace(/^["']|["']$/g, '');
    // Remove any "Here's a commit message:" or similar prefixes
    message = message.replace(/^(Here'?s? (is )?(a )?)?commit message:?\s*/i, '');
    // Remove excessive newlines (more than two consecutive newlines)
    message = message.replace(/\n{3,}/g, '\n\n');
    // Trim leading and trailing whitespace
    return message.trim();
}

async function setCommitMessage(commitMessage: string): Promise<void> {
    // Get the Git extension
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!gitExtension) {
        throw new Error('Git extension not found');
    }

    const git = gitExtension.exports.getAPI(1);

    const repos = git.repositories;
    if (repos.length === 0) {
        throw new Error('No Git repositories found');
    }

    // Use the first repository
    const repo = repos[0];

    // Set the commit message
    repo.inputBox.value = commitMessage;
    vscode.window.showInformationMessage('Commit message set in Git Source Control view.');
}

// Types for the Git extension API
interface GitExtension {
    getAPI(version: number): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
}

interface Repository {
    inputBox: {
        value: string;
    };
}

export function deactivate() {
    log('AutoCommit extension is now deactivated.');
}