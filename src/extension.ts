import * as vscode from 'vscode';
import * as child_process from 'child_process';
import axios from 'axios';

// Constants
const EXTENSION_NAME = 'GeminiCommit';
const COMMAND_ID = 'geminicommit.generateCommitMessage';
const VIEW_ID = 'geminiCommitView';
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";

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
        const apiKey = this.getApiKey();
        const language = this.getCommitLanguage();
        const prompt = this.generatePrompt(diff, language);
        const payload = this.createPayload(prompt);
        const headers = this.createHeaders(apiKey);

        try {
            const response = await axios.post(API_URL, payload, { headers });
            return this.cleanCommitMessage(response.data.candidates[0].content.parts[0].text);
        } catch (error) {
            throw new Error(`Error calling Google AI API: ${error}`);
        }
    }

    private static getApiKey(): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        const apiKey = config.get<string>('googleApiKey');

        if (!apiKey) {
            throw new Error('Google API key is not set. Please set it in the extension settings.');
        }

        return apiKey;
    }

    private static getCommitLanguage(): string {
        const config = vscode.workspace.getConfiguration('geminiCommit');
        return config.get<string>('commitLanguage', 'english');
    }

    private static generatePrompt(diff: string, language: string): string {
        const languageInstruction = language === 'russian' ?
            'Generate the commit message in Russian.' :
            'Generate the commit message in English.';

        return `As an expert developer specializing in creating informative and detailed Git commit messages, your task is to analyze the provided git diff output and generate a comprehensive commit message. ${languageInstruction} Follow these instructions carefully:
    
        1. Analyze the git diff thoroughly:
        * Identify ALL files that have been modified, added, or deleted.
        * Understand the nature of EACH change (e.g., feature addition, bug fix, refactoring, documentation update).
        * Determine the overall purpose or goal of the changes.
        * Note any significant implementation details or architectural changes across ALL modifications.

        2. Determine the commit type based on the following conditions:
        * feature: Only when adding a new feature.
        * fix: When fixing a bug.
        * docs: When updating documentation.
        * style: When changing elements styles or design and/or making changes to the code style (formatting, missing semicolons, etc.) without changing the code logic.
        * test: When adding or updating tests.
        * chore: When making changes to the build process or auxiliary tools and libraries.
        * revert: When undoing a previous commit.

        3. Create a concise commit message with the following structure:
        * Start with the commit type, followed by a colon and a space.
        * Each subsequent line describes a distinct, important change or aspect of the changes.
        * Start each line of the message (after the type) with a capitalized verb in the past tense.
        * Focus on describing what was changed and why, briefly.
        * Aim to cover the most significant changes.

        4. Additional guidelines:
        * Use 1 to 3 lines total (including the type line), depending on the scope of changes.
        * No blank lines between the lines of the commit message.
        * Keep each line between 20-50 characters (excluding the type).
        * Use extremely concise language, avoiding unnecessary words.
        * Prioritize breadth over depth - mention more changes rather than explaining few in detail.
        * Avoid technical jargon unless absolutely necessary.
        * Do not include specific file names or line numbers from the diff.

        5. Examples of good commit messages:

        English:
        fix: Fixed typo in login form validation

        feature: Added user profile functionality
        Implemented avatar upload and crop

        refactor: Reworked user database schema
        Optimized feed query performance
        Added data migration scripts for v2

        Russian:
        fix: Исправлена опечатка в форме входа

        feature: Добавлена страница профиля
        Реализована загрузка аватара

        refactor: Переработана схема БД пользователей
        Оптимизированы запросы для лент
        Добавлены скрипты миграции для v2

        6. Output:
        * Provide the complete commit message (1-3 lines, including the type).
        * No additional formatting or explanations.

        Git diff to analyze:
        ${diff}
        `;
    }

    private static createPayload(prompt: string) {
        return {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            },
        };
    }

    private static createHeaders(apiKey: string) {
        return {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
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