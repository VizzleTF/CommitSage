import * as vscode from 'vscode';
import { GeminiService } from '../services/geminiService';
import { ApiKeyManager } from '../services/apiKeyManager';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';
import { UserCancelledError } from '../models/errors';
import { ConfigService } from '../utils/configService';
import { handleHttpError } from '../services/baseAIService';

export function registerSelectGeminiModelCommand(): vscode.Disposable {
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

            const current = ConfigService.get('gemini.model');

            const items: vscode.QuickPickItem[] = [
                {
                    label: 'auto',
                    description: vscode.l10n.t('Try all models, prefer best quality'),
                    picked: current === 'auto',
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

            await ConfigService.set('gemini.model', picked.label);

            await Logger.showInfo(vscode.l10n.t('Gemini model set to {0}', picked.label));
        } catch (error) {
            if (error instanceof UserCancelledError) {
                return;
            }
            Logger.error('Failed to select Gemini model:', toError(error));
            await Logger.showError(
                vscode.l10n.t('Failed to fetch Gemini models: {0}', handleHttpError(toError(error), 'Gemini').errorMessage),
            );
        }
    });
}
