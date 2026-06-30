import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { Logger } from './utils/logger';
import { ConfigService } from './utils/configService';
import { SettingsValidator } from './services/settingsValidator';
import { TelemetryService } from './services/telemetryService';
import { registerCommands } from './commands';
import { ApiKeyManager } from './services/apiKeyManager';
import { toError } from './utils/errorUtils';
import { validateGeminiModelOnStartup } from './services/geminiModelValidator';
import { SettingsWebviewProvider } from './views/settingsWebviewProvider';
import { formatSupportsCommitlint } from './views/webview/commitFormatPolicy';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    Logger.log('Starting extension activation');

    try {
        await ConfigService.initialize(context);
        ApiKeyManager.initialize(context.secrets, context);
        Logger.initialize();
        await TelemetryService.initialize(context);

        Logger.log('Validating Git extension');
        await GitService.initialize();
    } catch (error) {
        Logger.error('Failed during initialization:', toError(error));
        void Logger.showError(vscode.l10n.t('Initialization failed: {0}', toError(error).message));
        return;
    }

    registerCommands(context);

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
        // Validation makes no sense for free-form custom prompts: switch the
        // checkbox off whenever the user picks the custom format, also when the
        // format is changed through the VS Code settings UI or settings.json.
        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('commitSage.commit.commitFormat')) { return; }
            const config = vscode.workspace.getConfiguration();
            const format = config.get<string>('commitSage.commit.commitFormat') ?? '';
            if (!formatSupportsCommitlint(format)
                && config.get('commitSage.commit.commitlint.enabled')) {
                void config.update('commitSage.commit.commitlint.enabled', false, vscode.ConfigurationTarget.Global);
            }
        }),
    );

    TelemetryService.sendEvent({ name: 'extension_activated' });
    Logger.log('Extension activated successfully');

    void validateGeminiModelOnStartup();
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
