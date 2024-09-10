import * as vscode from 'vscode';
import * as child_process from 'child_process';
import axios, { AxiosError } from 'axios';
import { longCommitInstructions, shortCommitInstructions, customInstructions } from './commitInstructions';

// Constants
const EXTENSION_NAME = 'GeminiCommit';
const COMMAND_ID = 'geminicommit.generateCommitMessage';
const VIEW_ID = 'geminiCommitView';

// Logger
class Logger {
    static log(message: string) {
        console.log(`[${EXTENSION_NAME}] ${message}`);
    }

    static error(message: string) {
        console.error(`[${EXTENSION_NAME}] ${message}`);
        vscode.window.showErrorMessage(message);
    }
}

// Git Service
class GitService {
    static async getDiff(): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }

        const rootPath = workspaceFolder.uri.fsPath;
        Logger.log(`Workspace root path: ${rootPath}`);

        return this.executeGitCommand('diff', rootPath);
    }

    private static async executeGitCommand(command: string, cwd: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            child_process.exec(`git ${command}`, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    reject(`Error executing git ${command}: ${error.message}`);
                    return;
                }

                if (stderr) {
                    reject(`Git error: ${stderr}`);
                    return;
                }

                resolve(stdout);
            });
        });
    }
}

// AI Service
class AIService {
    private static MAX_RETRIES = 3;
    private static RETRY_DELAY = 1000; // 1 second

    static async generateCommitMessage(diff: string): Promise<string> {
        const language = this.getCommitLanguage();
        const messageLength = this.getCommitMessageLength();
        const prompt = this.generatePrompt(diff, language, messageLength);

        return this.generateWithGemini(prompt);
    }

    private static getApiKey(): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        const key = config.get<string>('googleApiKey');

        if (!key) {
            throw new Error('Google API key is not set. Please set it in the extension settings.');
        }

        return key;
    }

    private static getGeminiModel(): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        return config.get<string>('geminiModel', 'gemini-1.5-flash');
    }

    private static getCommitLanguage(): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        return config.get<string>('commitLanguage', 'english');
    }

    private static getCommitMessageLength(): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        return config.get<string>('commitMessageLength', 'long');
    }

    private static getCustomInstructions(): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        return config.get<string>('customInstructions', '');
    }

    private static generatePrompt(diff: string, language: string, messageLength: string): string {
        const languageInstruction = language === 'russian' ?
            'Generate the commit message in Russian.' :
            'Generate the commit message in English.';

        let instructions;
        switch (messageLength) {
            case 'short':
                instructions = shortCommitInstructions;
                break;
            case 'custom':
                instructions = customInstructions.replace('{customInstructions}', this.getCustomInstructions());
                break;
            case 'long':
            default:
                instructions = longCommitInstructions;
        }

        return `${instructions.replace('{languageInstruction}', languageInstruction)}

        Git diff to analyze:
        ${diff}
        
        Please provide ONLY the commit message, without any additional text or explanations.`;
    }

    private static async generateWithGemini(prompt: string): Promise<string> {
        const apiKey = this.getApiKey();
        const model = this.getGeminiModel();
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
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

        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                const response = await axios.post(GEMINI_API_URL, payload, { headers });
                return this.cleanCommitMessage(response.data.candidates[0].content.parts[0].text);
            } catch (error) {
                if (attempt === this.MAX_RETRIES) {
                    this.logError(error);
                    throw new Error(`Failed to generate commit message after ${this.MAX_RETRIES} attempts: ${this.getErrorMessage(error)}`);
                }
                console.warn(`Attempt ${attempt} failed. Retrying in ${this.RETRY_DELAY / 1000} seconds...`);
                await this.delay(this.RETRY_DELAY);
            }
        }
        throw new Error('Unexpected error occurred');
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private static logError(error: unknown): void {
        if (axios.isAxiosError(error)) {
            console.error('Axios error:', {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status,
                headers: error.response?.headers,
            });
        } else {
            console.error('Non-Axios error:', error);
        }
    }

    private static getErrorMessage(error: unknown): string {
        if (axios.isAxiosError(error)) {
            return `${error.message} (Status: ${error.response?.status})`;
        }
        return error instanceof Error ? error.message : String(error);
    }

    private static cleanCommitMessage(message: string): string {
        return message
            .replace(/^["']|["']$/g, '')
            .replace(/^(Here'?s? (is )?(a )?)?commit message:?\s*/i, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}

// Tree Data Provider
class GeminiCommitTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            const generateButton = new vscode.TreeItem("Generate Commit Message");
            generateButton.command = {
                command: COMMAND_ID,
                title: `${EXTENSION_NAME}: Generate Message`
            };
            return Promise.resolve([generateButton]);
        }
    }
}

// Main Extension Functions
async function generateAndSetCommitMessage() {
    try {
        Logger.log('Fetching Git diff...');
        const diff = await GitService.getDiff();
        Logger.log('Git diff fetched successfully');

        Logger.log('Generating commit message...');
        const commitMessage = await AIService.generateCommitMessage(diff);
        Logger.log('Commit message generated successfully');

        Logger.log('Setting commit message in Source Control view...');
        await setCommitMessage(commitMessage);
        Logger.log('Commit message set successfully');
    } catch (error) {
        Logger.error(`Error in command execution: ${error}`);
    }
}

async function setCommitMessage(commitMessage: string): Promise<void> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!gitExtension) {
        throw new Error('Git extension not found');
    }

    const git = gitExtension.exports.getAPI(1);

    const repos = git.repositories;
    if (repos.length === 0) {
        throw new Error('No Git repositories found');
    }

    repos[0].inputBox.value = commitMessage;
    vscode.window.showInformationMessage('Commit message set in Git Source Control view.');
}

// Extension Activation and Deactivation
export function activate(context: vscode.ExtensionContext) {
    Logger.log(`${EXTENSION_NAME} extension is now active!`);

    const generateCommitMessageCommand = vscode.commands.registerCommand(COMMAND_ID, generateAndSetCommitMessage);

    const treeDataProvider = new GeminiCommitTreeDataProvider();
    const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider });

    context.subscriptions.push(generateCommitMessageCommand, treeView);
}

export function deactivate() {
    Logger.log(`${EXTENSION_NAME} extension is now deactivated.`);
}

// Types
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