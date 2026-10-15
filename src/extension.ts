import * as vscode from 'vscode';
import { GitRepositoryProvider } from './services/gitRepository';
import { Logger } from './utils/logger';
import { ConfigService } from './utils/configService';
import { SettingsValidator } from './services/settingsValidator';
import { TelemetryService } from './services/telemetryService';
import { registerCommands } from './commands';
import { ApiKeyManager } from './services/apiKeyManager';
import { toError } from './utils/errorUtils';
import { validateGeminiModelOnStartup } from './services/geminiModelValidator';
import { SettingsWebviewProvider } from './views/settingsWebviewProvider';
import { RefStore } from './services/refStore';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // First: everything logged before this (e.g. project-config warnings) is dropped.
    Logger.initialize();
    Logger.log('Starting extension activation');

    RefStore.init(context);
    ApiKeyManager.initialize(context.secrets);
    // Commands go in before the slow setup: a click during activation waits for
    // it in the handler, and a failed setup no longer leaves "command not found".
    const ready = initialize(context);
    registerCommands(context, ready);
    if (!await ready) {
        return;
    }

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SettingsWebviewProvider.viewId,
            new SettingsWebviewProvider(context),
        ),
    );

    void SettingsValidator.validateAllSettings();
    // Re-validate the project config whenever .commitsage/config.json is
    // created/changed/deleted, otherwise an invalid mid-session edit silently
    // reverts every project-level setting to defaults with no UI feedback.
    context.subscriptions.push(
        ConfigService.onProjectConfigChange(() => {
            void SettingsValidator.validateProjectConfig();
        }),
    );

    TelemetryService.sendEvent({ name: 'extension_activated' });
    Logger.log('Extension activated successfully');

    void validateGeminiModelOnStartup();
}

async function initialize(context: vscode.ExtensionContext): Promise<boolean> {
    try {
        await ConfigService.initialize(context);
        await TelemetryService.initialize(context);

        Logger.log('Validating Git extension');
        await GitRepositoryProvider.validateGitExtension();
        return true;
    } catch (error) {
        Logger.error('Failed during initialization:', toError(error));
        void Logger.showError(vscode.l10n.t('Initialization failed: {0}', toError(error).message));
        return false;
    }
}

export async function deactivate(): Promise<void> {
    Logger.log('Deactivating extension');

    try {
        // Send deactivation event before shutting down telemetry
        TelemetryService.sendEvent({ name: 'extension_deactivated' });

        // Wait for telemetry to flush remaining events
        await TelemetryService.flush();

        // Dispose services in reverse order of initialization
        TelemetryService.dispose();
        ConfigService.dispose();

        Logger.log('Extension deactivated successfully');
        Logger.dispose();
    } catch (error) {
        // Fallback logging if Logger is already disposed
        console.error('Error during extension deactivation:', error);
    }
}
