import * as vscode from 'vscode';
import { spawn } from 'child_process';
import axios from 'axios';
import {
    englishShortInstructions,
    englishLongInstructions,
    russianShortInstructions,
    russianLongInstructions,
    customInstructions
} from './commitInstructions';

// Constants
const EXTENSION_NAME = 'GeminiCommit';
const COMMAND_ID = 'geminicommit.generateCommitMessage';
const VIEW_ID = 'geminiCommitView';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_DIFF_LENGTH = 10000;
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const DEFAULT_COMMIT_LANGUAGE = 'english';
const DEFAULT_COMMIT_MESSAGE_LENGTH = 'long';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const ERROR_MESSAGES = {
    NO_GIT_EXTENSION: 'Git extension not found. Please make sure it is installed and enabled.',
    NO_REPOSITORIES: 'No Git repositories found in the current workspace.',
    NO_CHANGES: 'No changes detected in the repository.',
    NO_REPO_SELECTED: 'No repository selected. Operation cancelled.',
    EMPTY_COMMIT_MESSAGE: 'Generated commit message is empty.',
    API_KEY_NOT_SET: 'Google API key is not set. Please set it in the extension settings.'
};

// Types
type GitExtension = { getAPI(version: number): GitAPI };
type GitAPI = { repositories: Repository[] };
type Repository = { rootUri: vscode.Uri; inputBox: { value: string } };
type ErrorWithResponse = Error & { response?: { status: number; data: any } };

// Logger
class Logger {
    static log = (message: string): void =>
        console.log(`[${EXTENSION_NAME}] ${message}`);

    static error = (message: string, error?: Error): void => {
        console.error(`[${EXTENSION_NAME}] ${message}`);
        error?.stack && console.error(`Stack trace: ${error.stack}`);
        vscode.window.showErrorMessage(message);
    };
}

// Configuration Service
class ConfigService {
    private static cache = new Map<string, any>();

    static getConfig = <T>(key: string, defaultValue: T): T => {
        if (!this.cache.has(key)) {
            const value = vscode.workspace.getConfiguration('geminiCommit').get<T>(key) ?? defaultValue;
            this.cache.set(key, value);
        }
        return this.cache.get(key);
    };

    static getApiKey = (): string => {
        const key = this.getConfig<string>('googleApiKey', '');
        if (!key) throw new Error(ERROR_MESSAGES.API_KEY_NOT_SET);
        return key;
    };

    static getGeminiModel = (): string =>
        this.getConfig<string>('geminiModel', DEFAULT_GEMINI_MODEL);

    static getCommitLanguage = (): string =>
        this.getConfig<string>('commitLanguage', DEFAULT_COMMIT_LANGUAGE);

    static getCommitMessageLength = (): string =>
        this.getConfig<string>('commitMessageLength', DEFAULT_COMMIT_MESSAGE_LENGTH);

    static getCustomInstructions = (): string =>
        this.getConfig<string>('customInstructions', '');

    static clearCache = (): void => this.cache.clear();
}

// Git Service
class GitService {
    static getDiff = async (repoPath: string): Promise<string> => {
        Logger.log(`Getting diff for repository: ${repoPath}`);
        const diff = await this.executeGitCommand('diff', repoPath);
        if (!diff.trim()) throw new Error(ERROR_MESSAGES.NO_CHANGES);
        return diff;
    };

    private static executeGitCommand = (command: string, cwd: string): Promise<string> =>
        new Promise((resolve, reject) => {
            const childProcess = spawn('git', [command], { cwd });
            let stdout = '';
            let stderr = '';

            childProcess.stdout.on('data', (data) => { stdout += data; });
            childProcess.stderr.on('data', (data) => { stderr += data; });
            childProcess.on('close', (code) => {
                code !== 0
                    ? reject(new Error(`Git ${command} failed with code ${code}: ${stderr}`))
                    : resolve(stdout);
            });
        });

    static getRepositories = async (): Promise<Repository[]> => {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) throw new Error(ERROR_MESSAGES.NO_GIT_EXTENSION);

        const git = gitExtension.exports.getAPI(1);
        const repos = git.repositories;
        if (repos.length === 0) throw new Error(ERROR_MESSAGES.NO_REPOSITORIES);

        return repos;
    };

    static selectRepository = async (repos: Repository[]): Promise<Repository> => {
        if (repos.length === 1) return repos[0];

        const repoOptions = repos.map(repo => ({
            label: repo.rootUri.fsPath,
            repository: repo
        }));

        const selected = await vscode.window.showQuickPick(repoOptions, {
            placeHolder: 'Select the repository to generate commit message'
        });

        if (!selected) throw new Error(ERROR_MESSAGES.NO_REPO_SELECTED);
        return selected.repository;
    };
}

// Prompt Service
class PromptService {
    static generatePrompt = (diff: string, language: string, messageLength: string): string => {
        const instructions = this.getInstructions(language, messageLength);
        return `${instructions}
      
      Git diff to analyze:
      ${diff}
      
      Please provide ONLY the commit message, without any additional text or explanations.`;
    };

    private static getInstructions = (language: string, messageLength: string): string => {
        type InstructionKey = 'english-short' | 'english-long' | 'russian-short' | 'russian-long' | 'custom';
        const key = `${language}-${messageLength}` as InstructionKey;

        const instructionsMap: Record<InstructionKey, string> = {
            'english-short': englishShortInstructions,
            'english-long': englishLongInstructions,
            'russian-short': russianShortInstructions,
            'russian-long': russianLongInstructions,
            'custom': customInstructions.replace('{customInstructions}', ConfigService.getCustomInstructions())
        };

        return instructionsMap[key] ?? englishShortInstructions;
    };
}

// AI Service
class AIService {
    static generateCommitMessage = async (
        diff: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<string> => {
        const language = ConfigService.getCommitLanguage();
        const messageLength = ConfigService.getCommitMessageLength();
        const truncatedDiff = this.truncateDiff(diff);
        const prompt = PromptService.generatePrompt(truncatedDiff, language, messageLength);

        progress.report({ message: "Generating commit message...", increment: 50 });
        return this.generateWithGemini(prompt, progress);
    };

    private static truncateDiff = (diff: string): string => {
        if (diff.length > MAX_DIFF_LENGTH) {
            Logger.log(`Original diff length: ${diff.length}. Truncating to ${MAX_DIFF_LENGTH} characters.`);
            return `${diff.substring(0, MAX_DIFF_LENGTH)}\n...(truncated)`;
        }
        Logger.log(`Diff length: ${diff.length} characters`);
        return diff;
    };

    private static generateWithGemini = async (
        prompt: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        attempt: number = 1
    ): Promise<string> => {
        const apiKey = ConfigService.getApiKey();
        const model = ConfigService.getGeminiModel();
        const GEMINI_API_URL = `${GEMINI_API_BASE_URL}/${model}:generateContent`;

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
            Logger.log(`Attempt ${attempt}: Sending request to Gemini API`);
            progress.report({ message: `Attempt ${attempt}: Generating commit message...`, increment: 10 });
            const { data } = await axios.post(GEMINI_API_URL, payload, { headers });
            Logger.log('Gemini API response received successfully');
            progress.report({ message: "Commit message generated successfully", increment: 100 });
            const commitMessage = this.cleanCommitMessage(data.candidates[0].content.parts[0].text);
            if (!commitMessage.trim()) throw new Error(ERROR_MESSAGES.EMPTY_COMMIT_MESSAGE);
            return commitMessage;
        } catch (error) {
            Logger.error(`Attempt ${attempt} failed:`, error as Error);
            const { errorMessage, shouldRetry } = this.handleApiError(error as ErrorWithResponse);

            if (shouldRetry && attempt < MAX_RETRIES) {
                const delayMs = this.calculateRetryDelay(attempt);
                Logger.log(`Retrying in ${delayMs / 1000} seconds...`);
                progress.report({ message: `Retrying in ${delayMs / 1000} seconds...`, increment: 0 });
                await this.delay(delayMs);
                return this.generateWithGemini(prompt, progress, attempt + 1);
            }

            throw new Error(`Failed to generate commit message: ${errorMessage}`);
        }
    };

    private static calculateRetryDelay = (attempt: number): number =>
        Math.min(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1), 10000);

    private static delay = (ms: number): Promise<void> =>
        new Promise(resolve => setTimeout(resolve, ms));

    private static handleApiError = (error: ErrorWithResponse): { errorMessage: string, shouldRetry: boolean } => {
        if (error.response) {
            const { status, data } = error.response;
            const responseData = JSON.stringify(data);

            if (status === 403) {
                return {
                    errorMessage: `Access forbidden. Please check your API key. (Status: ${status})`,
                    shouldRetry: false
                };
            } else if (status === 429) {
                return {
                    errorMessage: `Rate limit exceeded. Please try again later. (Status: ${status})`,
                    shouldRetry: true
                };
            }

            return {
                errorMessage: `${error.message} (Status: ${status}). Response data: ${responseData}`,
                shouldRetry: status >= 500
            };
        }
        return { errorMessage: error.message, shouldRetry: true };
    };

    private static cleanCommitMessage = (message: string): string =>
        message
            .replace(/^["']|["']$/g, '')
            .replace(/^(Here'?s? (is )?(a )?)?commit message:?\s*/i, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
}

// Tree Data Provider
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

// Main Extension Functions
const generateAndSetCommitMessage = async () => {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Generating Commit Message",
        cancellable: false
    }, async (progress) => {
        try {
            const repos = await GitService.getRepositories();
            const selectedRepo = await GitService.selectRepository(repos);

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
            Logger.error('Error in command execution:', error as Error);
            vscode.window.showErrorMessage(`Failed to generate commit message: ${(error as Error).message}`);
        }
    });
};

// Extension Activation and Deactivation
export const activate = (context: vscode.ExtensionContext): void => {
    Logger.log(`${EXTENSION_NAME} extension is now active!`);

    const generateCommitMessageCommand = vscode.commands.registerCommand(COMMAND_ID, generateAndSetCommitMessage);

    const treeDataProvider = new GeminiCommitTreeDataProvider();
    const treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider });

    context.subscriptions.push(generateCommitMessageCommand, treeView);
};

export const deactivate = (): void => {
    Logger.log(`${EXTENSION_NAME} extension is now deactivated.`);
    ConfigService.clearCache();
};