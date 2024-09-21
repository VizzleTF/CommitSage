import * as vscode from 'vscode';
import * as child_process from 'child_process';
import axios from 'axios';
import { englishShortInstructions, englishLongInstructions, russianShortInstructions, russianLongInstructions, customInstructions } from './commitInstructions';

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
    static async getDiff(repoPath: string): Promise<string> {
        Logger.log(`Getting diff for repository: ${repoPath}`);
        return this.executeGitCommand('diff', repoPath);
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
    private static MAX_DIFF_LENGTH = 10000; // Limit diff to 10000 characters

    static async generateCommitMessage(diff: string, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<string> {
        const language = this.getCommitLanguage();
        const messageLength = this.getCommitMessageLength();
        const truncatedDiff = this.truncateDiff(diff);
        const prompt = this.generatePrompt(truncatedDiff, language, messageLength);

        progress.report({ message: "Generating commit message...", increment: 50 });
        return this.generateWithGemini(prompt, progress);
    }

    private static truncateDiff(diff: string): string {
        if (diff.length > this.MAX_DIFF_LENGTH) {
            console.log(`Original diff length: ${diff.length}. Truncating to ${this.MAX_DIFF_LENGTH} characters.`);
            return diff.substring(0, this.MAX_DIFF_LENGTH) + "\n...(truncated)";
        }
        console.log(`Diff length: ${diff.length} characters`);
        return diff;
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
        let instructions;
        switch (`${language}-${messageLength}`) {
            case 'english-short':
                instructions = englishShortInstructions;
                break;
            case 'english-long':
                instructions = englishLongInstructions;
                break;
            case 'russian-short':
                instructions = russianShortInstructions;
                break;
            case 'russian-long':
                instructions = russianLongInstructions;
                break;
            case 'custom':
                instructions = customInstructions.replace('{customInstructions}', this.getCustomInstructions());
                break;
            default:
                instructions = englishShortInstructions;
        }

        return `${instructions}
    
        Git diff to analyze:
        ${diff}
        
        Please provide ONLY the commit message, without any additional text or explanations.`;
    }

    private static async generateWithGemini(prompt: string, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<string> {
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
                console.log(`Attempt ${attempt}: Sending request to Gemini API`);
                progress.report({ message: `Attempt ${attempt}: Generating commit message...`, increment: 10 });
                const response = await axios.post(GEMINI_API_URL, payload, { headers });
                console.log('Gemini API response received successfully');
                progress.report({ message: "Commit message generated successfully", increment: 100 });
                return this.cleanCommitMessage(response.data.candidates[0].content.parts[0].text);
            } catch (error) {
                console.error(`Attempt ${attempt} failed:`, error);
                const { errorMessage, shouldRetry } = this.getErrorMessage(error);

                if (!shouldRetry || attempt === this.MAX_RETRIES) {
                    throw new Error(`Failed to generate commit message: ${errorMessage}`);
                }

                console.warn(`Retrying in ${this.RETRY_DELAY / 1000} seconds...`);
                progress.report({ message: `Retrying in ${this.RETRY_DELAY / 1000} seconds...`, increment: 0 });
                await this.delay(this.RETRY_DELAY);
            }
        }
        throw new Error('Unexpected error occurred');
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private static getErrorMessage(error: unknown): { errorMessage: string, shouldRetry: boolean } {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                const status = error.response.status;
                const responseData = JSON.stringify(error.response.data);

                // Check for specific error codes
                if (status === 403) {
                    return {
                        errorMessage: `Access forbidden. Please check your API key. (Status: ${status})`,
                        shouldRetry: false
                    };
                } else if (status === 429) {
                    return {
                        errorMessage: `Rate limit exceeded. Please try again later. (Status: ${status})`,
                        shouldRetry: false
                    };
                }

                return {
                    errorMessage: `${error.message} (Status: ${status}). Response data: ${responseData}`,
                    shouldRetry: true
                };
            }
            return { errorMessage: error.message, shouldRetry: true };
        }
        return {
            errorMessage: error instanceof Error ? error.message : String(error),
            shouldRetry: true
        };
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
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Generating Commit Message",
        cancellable: false
    }, async (progress) => {
        try {
            const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (!gitExtension) {
                throw new Error('Git extension not found');
            }
            const git = gitExtension.exports.getAPI(1);
            const repos = git.repositories;

            if (repos.length === 0) {
                throw new Error('No Git repositories found');
            }

            let selectedRepo: Repository | undefined;
            if (repos.length > 1) {
                const repoOptions = repos.map(repo => ({
                    label: repo.rootUri.fsPath,
                    repository: repo
                }));
                const selected = await vscode.window.showQuickPick(repoOptions, {
                    placeHolder: 'Select the repository to generate commit message'
                });
                if (!selected) {
                    throw new Error('No repository selected');
                }
                selectedRepo = selected.repository;
            } else {
                selectedRepo = repos[0];
            }

            progress.report({ message: "Fetching Git diff...", increment: 0 });
            const diff = await GitService.getDiff(selectedRepo.rootUri.fsPath);
            Logger.log(`Git diff fetched successfully. Length: ${diff.length} characters`);

            progress.report({ message: "Analyzing diff...", increment: 25 });
            const commitMessage = await AIService.generateCommitMessage(diff, progress);
            Logger.log('Commit message generated successfully');

            progress.report({ message: "Setting commit message...", increment: 75 });
            selectedRepo.inputBox.value = commitMessage;
            Logger.log('Commit message set successfully');

            progress.report({ message: "Done!", increment: 100 });
            vscode.window.showInformationMessage('Commit message set in selected Git repository.');
        } catch (error) {
            Logger.error(`Error in command execution: ${error}`);
            vscode.window.showErrorMessage(`Failed to generate commit message: ${error}`);
        }
    });
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
    rootUri: vscode.Uri;
    inputBox: {
        value: string;
    };
}