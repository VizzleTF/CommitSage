import * as vscode from 'vscode';
import * as child_process from 'child_process';
import axios from 'axios';
import { longCommitInstructions, shortCommitInstructions, customInstructions } from './commitInstructions';

// Constants
const EXTENSION_NAME = 'GeminiCommit';
const COMMAND_ID = 'geminicommit.generateCommitMessage';
const VIEW_ID = 'geminiCommitView';
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";
const COHERE_API_URL = "https://api.cohere.ai/v1/generate";

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
    static async generateCommitMessage(diff: string): Promise<string> {
        const aiProvider = this.getAIProvider();
        const language = this.getCommitLanguage();
        const messageLength = this.getCommitMessageLength();
        const prompt = this.generatePrompt(diff, language, messageLength);

        if (aiProvider === 'gemini') {
            return this.generateWithGemini(prompt);
        } else {
            return this.generateWithCohere(prompt);
        }
    }

    private static getAIProvider(): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        return config.get<string>('aiProvider', 'gemini');
    }

    private static getApiKey(provider: string): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        const key = provider === 'gemini' ? config.get<string>('googleApiKey') : config.get<string>('cohereApiKey');

        if (!key) {
            throw new Error(`${provider.charAt(0).toUpperCase() + provider.slice(1)} API key is not set. Please set it in the extension settings.`);
        }

        return key;
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
        const apiKey = this.getApiKey('gemini');
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

        try {
            const response = await axios.post(GEMINI_API_URL, payload, { headers });
            return this.cleanCommitMessage(response.data.candidates[0].content.parts[0].text);
        } catch (error) {
            throw new Error(`Error calling Gemini AI API: ${error}`);
        }
    }

    private static async generateWithCohere(prompt: string): Promise<string> {
        const apiKey = this.getApiKey('cohere');
        const payload = {
            model: 'command',
            prompt: prompt,
            max_tokens: 100,
            temperature: 0.7,
            k: 0,
            p: 0.75,
            frequency_penalty: 0,
            presence_penalty: 0,
            stop_sequences: [],
            return_likelihoods: 'NONE'
        };
        const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        };

        try {
            const response = await axios.post(COHERE_API_URL, payload, { headers });
            return this.cleanCommitMessage(response.data.generations[0].text);
        } catch (error) {
            throw new Error(`Error calling Cohere AI API: ${error}`);
        }
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