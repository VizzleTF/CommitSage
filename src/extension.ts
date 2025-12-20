import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { Logger } from './utils/logger';
import { ConfigService } from './utils/configService';
import { SettingsValidator } from './services/settingsValidator';
import { TelemetryService } from './services/telemetryService';
import { registerCommands } from './commands';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    void Logger.log('Starting extension activation');

    try {
        await ConfigService.initialize(context);
        await Logger.initialize();
        await TelemetryService.initialize(context);

        void Logger.log('Validating Git extension');
        await GitService.validateGitExtension();
        await GitService.initialize();
    } catch (error) {
        void Logger.error('Failed during initialization:', error as Error);
        void Logger.showError(`Initialization failed: ${(error as Error).message}`);
        return;
    }

    registerCommands(context);

    void SettingsValidator.validateAllSettings();
    void TelemetryService.sendEvent('extension_activated');
    void Logger.log('Extension activated successfully');
}

export async function deactivate(): Promise<void> {
    void Logger.log('Deactivating extension');

    try {
        // Send deactivation event before shutting down telemetry
        TelemetryService.sendEvent('extension_deactivated');

        // Wait for telemetry to flush remaining events
        await TelemetryService.flush();

        // Dispose services in reverse order of initialization
        TelemetryService.dispose();
        ConfigService.dispose();
        Logger.dispose();

        void Logger.log('Extension deactivated successfully');
    } catch (error) {
        // Fallback logging if Logger is already disposed
        console.error('Error during extension deactivation:', error);
    }
}
