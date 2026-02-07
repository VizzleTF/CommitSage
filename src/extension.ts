import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { Logger } from './utils/logger';
import { ConfigService } from './utils/configService';
import { SettingsValidator } from './services/settingsValidator';
import { TelemetryService } from './services/telemetryService';
import { registerCommands } from './commands';
import { ApiKeyManager } from './services/apiKeyManager';
import { toError } from './utils/errorUtils';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    Logger.log('Starting extension activation');

    try {
        await ConfigService.initialize(context);
        ApiKeyManager.initialize(context.secrets);
        Logger.initialize();
        await TelemetryService.initialize(context);

        Logger.log('Validating Git extension');
        await GitService.validateGitExtension();
        await GitService.initialize();
    } catch (error) {
        Logger.error('Failed during initialization:', toError(error));
        void Logger.showError(`Initialization failed: ${toError(error).message}`);
        return;
    }

    registerCommands(context);

    void SettingsValidator.validateAllSettings();
    TelemetryService.sendEvent('extension_activated');
    Logger.log('Extension activated successfully');
}

export async function deactivate(): Promise<void> {
    Logger.log('Deactivating extension');

    try {
        // Send deactivation event before shutting down telemetry
        TelemetryService.sendEvent('extension_deactivated');

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
