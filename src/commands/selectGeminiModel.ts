import * as vscode from 'vscode';
import { GeminiService } from '../services/geminiService';
import { ApiKeyManager } from '../services/apiKeyManager';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';
import { UserCancelledError } from '../models/errors';

const SETTING_KEY = 'commitSage.gemini.model';
const AUTO_VALUE = 'auto';

export function registerSelectGeminiModelCommand(_context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('commitsage.selectGeminiModel', async () => {
        try {
            const apiKey = await ApiKeyManager.getKey('gemini');

            const models = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: vscode.l10n.t('Fetching available Gemini models...'),
                    cancellable: false,
                },
                () => GeminiService.getAvailableModels(apiKey),
            );

            if (models.length === 0) {
                await Logger.showError(vscode.l10n.t('No Gemini models available for this API key'));
                return;
            }

            const current = vscode.workspace.getConfiguration().get<string>(SETTING_KEY) ?? AUTO_VALUE;

            const items: vscode.QuickPickItem[] = [
                {
                    label: AUTO_VALUE,
                    description: vscode.l10n.t('Try all models, prefer best quality'),
                    picked: current === AUTO_VALUE,
                },
                ...models.map(m => ({
                    label: m,
                    description: m === current ? vscode.l10n.t('current') : undefined,
                    picked: m === current,
                })),
            ];

            const picked = await vscode.window.showQuickPick(items, {
                title: vscode.l10n.t('Select Gemini Model'),
                placeHolder: vscode.l10n.t('Live list fetched from Google. Current: {0}', current),
                ignoreFocusOut: true,
            });

            if (!picked) {
                return;
            }

            await vscode.workspace
                .getConfiguration()
                .update(SETTING_KEY, picked.label, vscode.ConfigurationTarget.Global);

            await Logger.showInfo(vscode.l10n.t('Gemini model set to {0}', picked.label));
        } catch (error) {
            if (error instanceof UserCancelledError) {
                return;
            }
            Logger.error('Failed to select Gemini model:', toError(error));
            await Logger.showError(
                vscode.l10n.t('Failed to fetch Gemini models: {0}', toError(error).message),
            );
        }
    });
}
