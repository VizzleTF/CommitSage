import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

async function statOrUndefined(p: string): Promise<import('fs').Stats | undefined> {
    try {
        return await fs.stat(p);
    } catch {
        return undefined;
    }
}

export async function createProjectConfig(): Promise<void> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await Logger.showError(vscode.l10n.t('No workspace folder found. Please open a project first.'));
            return;
        }

        const configDir = path.join(workspaceFolder.uri.fsPath, '.commitsage');
        const configPath = path.join(configDir, 'config.json');
        const dirStats = await statOrUndefined(configDir);
        const legacyExists = dirStats?.isFile() ?? false;
        const configExists = (await statOrUndefined(configPath)) !== undefined;

        if (legacyExists || configExists) {
            const openExisting = vscode.l10n.t('Open Existing');
            const overwrite = vscode.l10n.t('Overwrite');
            const cancel = vscode.l10n.t('Cancel');
            const selection = await Logger.showWarning(
                vscode.l10n.t('A .commitsage configuration already exists in this project.'),
                openExisting,
                overwrite,
                cancel
            );

            if (selection === openExisting) {
                const target = legacyExists ? configDir : configPath;
                const uri = vscode.Uri.file(target);
                void vscode.window.showTextDocument(uri);
                return;
            } else if (selection !== overwrite) {
                return;
            }

            if (legacyExists) {
                await fs.unlink(configDir);
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
                model: 'auto'
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

        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
            configPath,
            JSON.stringify(templateConfig, null, 2),
            'utf8'
        );

        Logger.log('Created .commitsage/config.json configuration file');

        const uri = vscode.Uri.file(configPath);
        void vscode.window.showTextDocument(uri);

        Logger.log('Project configuration file (.commitsage/config.json) has been created and opened for editing.');

    } catch (error) {
        Logger.error('Error creating .commitsage/config.json file:', toError(error));
        await Logger.showError(vscode.l10n.t('Failed to create .commitsage/config.json: {0}', toError(error).message));
    }
}
