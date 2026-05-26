import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { ApiKeyManager } from './apiKeyManager';
import { GeminiService } from './geminiService';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

const SETTING_KEY = 'commitSage.gemini.model';
const AUTO_VALUE = 'auto';

/**
 * If Google sunsets the configured Gemini model (e.g. a preview alias), the
 * user only learns about it via a 404 at generation time. This runs once on
 * activation, compares the stored model against the live list, and offers a
 * fix path before the next generation fails.
 *
 * Best-effort: silent on no API key, on offline, on any network error.
 */
export async function validateGeminiModelOnStartup(): Promise<void> {
    if (ConfigService.get('provider.type') !== 'gemini') {
        return;
    }

    const configured = ConfigService.get('gemini.model');
    if (configured === AUTO_VALUE) {
        return;
    }

    const apiKey = await ApiKeyManager.getOptionalKey('gemini');
    if (!apiKey) {
        return;
    }

    let liveModels: string[];
    try {
        liveModels = await GeminiService.getAvailableModels(apiKey);
    } catch (error) {
        Logger.log(`Skipping Gemini model validation: ${toError(error).message}`);
        return;
    }

    if (liveModels.length === 0 || liveModels.includes(configured)) {
        return;
    }

    Logger.log(`Configured Gemini model "${configured}" not in live list. Prompting user.`);

    const pick = vscode.l10n.t('Pick a model');
    const useAuto = vscode.l10n.t('Switch to auto');
    const selection = await vscode.window.showWarningMessage(
        vscode.l10n.t(
            'Commit Sage: Gemini model "{0}" is no longer available. Choose a current model or switch to auto.',
            configured,
        ),
        pick,
        useAuto,
    );

    if (selection === pick) {
        await vscode.commands.executeCommand('commitsage.settings.focus');
    } else if (selection === useAuto) {
        await vscode.workspace
            .getConfiguration()
            .update(SETTING_KEY, AUTO_VALUE, vscode.ConfigurationTarget.Global);
    }
}
