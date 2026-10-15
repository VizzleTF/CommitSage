import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';
import { statOrUndefined } from '../utils/fsUtils';
import { ConfigService } from '../utils/configService';

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

        // Every key here overrides user and workspace settings for everyone who
        // clones the repo, so start from the current format and language only;
        // docs/configuration.md lists the rest.
        const templateConfig = {
            commit: {
                commitFormat: ConfigService.get('commit.commitFormat'),
                commitLanguage: ConfigService.get('commit.commitLanguage'),
                customLanguageName: ConfigService.get('commit.customLanguageName'),
            },
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
