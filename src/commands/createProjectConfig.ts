import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

export async function createProjectConfig(): Promise<void> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await Logger.showError(vscode.l10n.t('No workspace folder found. Please open a project first.'));
            return;
        }

        const configDir = path.join(workspaceFolder.uri.fsPath, '.commitsage');
        const configPath = path.join(configDir, 'config.json');
        const legacyExists =
            fs.existsSync(configDir) && fs.statSync(configDir).isFile();
        const configExists = fs.existsSync(configPath);

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
                fs.unlinkSync(configDir);
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

        await fs.promises.mkdir(configDir, { recursive: true });
        await fs.promises.writeFile(
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
