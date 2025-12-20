import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

export async function createProjectConfig(): Promise<void> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await Logger.showError('No workspace folder found. Please open a project first.');
            return;
        }

        const configPath = path.join(workspaceFolder.uri.fsPath, '.commitsage');

        if (fs.existsSync(configPath)) {
            const selection = await Logger.showWarning(
                'A .commitsage file already exists in this project.',
                'Open Existing',
                'Overwrite',
                'Cancel'
            );

            if (selection === 'Open Existing') {
                const uri = vscode.Uri.file(configPath);
                void vscode.window.showTextDocument(uri);
                return;
            } else if (selection !== 'Overwrite') {
                return;
            }
        }

        const templateConfig = {
            provider: {
                type: 'gemini'
            },
            commit: {
                commitLanguage: 'english',
                commitFormat: 'conventional',
                useCustomInstructions: false,
                customInstructions: '',
                onlyStagedChanges: false,
                autoCommit: false,
                autoPush: false,
                promptForRefs: false
            },
            gemini: {
                model: 'gemini-1.5-flash'
            },
            codestral: {
                model: 'codestral-latest'
            },
            openai: {
                model: 'gpt-3.5-turbo',
                baseUrl: 'https://api.openai.com/v1'
            },
            ollama: {
                baseUrl: 'http://localhost:11434',
                model: 'llama3.2'
            },
            telemetry: {
                enabled: true
            }
        };

        fs.writeFileSync(configPath, JSON.stringify(templateConfig, null, 2), 'utf8');

        void Logger.log('Created .commitsage configuration file');

        const uri = vscode.Uri.file(configPath);
        void vscode.window.showTextDocument(uri);

        void Logger.log('Project configuration file (.commitsage) has been created and opened for editing.');

    } catch (error) {
        void Logger.error('Error creating .commitsage file:', error as Error);
        await Logger.showError(`Failed to create .commitsage file: ${(error as Error).message}`);
    }
}