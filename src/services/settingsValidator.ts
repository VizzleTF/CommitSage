import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';

export class SettingsValidator {
    static async validateAllSettings(): Promise<void> {
        await this.validateAutoPushState();
        await this.validateCustomEndpoint();
        await this.validateCustomInstructions();
        await this.validateRefsWithAutoCommit();
    }

    static async validateAutoPushState(): Promise<void> {
        const isAutoPushEnabled = ConfigService.getAutoPushEnabled();
        const isAutoCommitEnabled = ConfigService.getAutoCommitEnabled();

        if (isAutoPushEnabled && !isAutoCommitEnabled) {
            const selection = await vscode.window.showWarningMessage(
                'Auto Push requires Auto Commit to be enabled. Choose an action:',
                'Enable Auto Commit',
                'Disable Auto Push',
                'Open Settings'
            );

            if (selection === 'Enable Auto Commit') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.autoCommit', true, true);
                void Logger.log('Auto Commit has been enabled');
            } else if (selection === 'Disable Auto Push') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.autoPush', false, true);
                void Logger.log('Auto Push has been disabled');
            } else if (selection === 'Open Settings') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.commit'
                );
            }
        }
    }

    static async validateCustomEndpoint(): Promise<void> {
        const useCustomEndpoint = ConfigService.useCustomEndpoint();
        const endpoint = ConfigService.getCustomEndpoint();
        const model = ConfigService.getCustomModel();

        if (useCustomEndpoint && (!endpoint || !model)) {
            const selection = await vscode.window.showWarningMessage(
                'Custom Endpoint requires both URL and model name. Configure now?',
                'Configure',
                'Disable Custom Endpoint',
                'Open Settings'
            );

            if (selection === 'Configure') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.custom.endpoint'
                );
            } else if (selection === 'Disable Custom Endpoint') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('custom.useCustomEndpoint', false, true);
                void Logger.log('Custom Endpoint has been disabled');
            } else if (selection === 'Open Settings') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.custom'
                );
            }
        }
    }

    static async validateCustomInstructions(): Promise<void> {
        const useCustomInstructions = ConfigService.useCustomInstructions();
        const instructions = ConfigService.getCustomInstructions();

        if (useCustomInstructions && !instructions.trim()) {
            const selection = await vscode.window.showWarningMessage(
                'Custom Instructions are enabled but empty. What would you like to do?',
                'Add Instructions',
                'Disable Custom Instructions',
                'Open Settings'
            );

            if (selection === 'Add Instructions') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.commit.customInstructions'
                );
            } else if (selection === 'Disable Custom Instructions') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.useCustomInstructions', false, true);
                void Logger.log('Custom Instructions have been disabled');
            } else if (selection === 'Open Settings') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.commit'
                );
            }
        }
    }

    static async validateRefsWithAutoCommit(): Promise<void> {
        const autoCommitEnabled = ConfigService.getAutoCommitEnabled();
        const promptForRefs = ConfigService.shouldPromptForRefs();

        if (autoCommitEnabled && promptForRefs) {
            const selection = await vscode.window.showWarningMessage(
                'Prompting for refs may interrupt the automatic commit flow. Choose an action:',
                'Disable Refs Prompt',
                'Disable Auto Commit',
                'Keep Both'
            );

            if (selection === 'Disable Refs Prompt') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.promptForRefs', false, true);
                void Logger.log('Refs prompt has been disabled');
            } else if (selection === 'Disable Auto Commit') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.autoCommit', false, true);
                void Logger.log('Auto Commit has been disabled');
            } else if (selection === 'Keep Both') {
                void Logger.log('User chose to keep both Auto Commit and Refs prompt enabled');
            }
        }
    }

    public static validateCommitFormat(): boolean {
        const config = vscode.workspace.getConfiguration('commitSage');
        const format = config.get<string>('commit.commitFormat');
        return format !== undefined && format.length > 0;
    }

    public static validateCustomEndpointUrl(): boolean {
        const config = vscode.workspace.getConfiguration('commitSage');
        const endpoint = config.get<string>('custom.endpoint');
        return endpoint !== undefined && endpoint.length > 0;
    }

    public static validateCustomInstructionsText(): boolean {
        const config = vscode.workspace.getConfiguration('commitSage');
        const instructions = config.get<string>('commit.customInstructions');
        return instructions !== undefined && instructions.length > 0;
    }

    public static validateTelemetrySettings(): void {
        const config = vscode.workspace.getConfiguration('commitSage');
    }

    public static async handleAutoCommitConflict(): Promise<void> {
        try {
            const selection = await vscode.window.showWarningMessage(
                'Auto Push is enabled but Auto Commit is disabled. Auto Push requires Auto Commit to be enabled.',
                'Enable Auto Commit',
                'Disable Auto Push',
                'Open Settings'
            );

            if (selection === 'Enable Auto Commit') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.autoCommit', true, true);
                void Logger.log('Auto Commit has been enabled');
            } else if (selection === 'Disable Auto Push') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.autoPush', false, true);
                void Logger.log('Auto Push has been disabled');
            } else if (selection === 'Open Settings') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.commit'
                );
            }
        } catch (error) {
            void Logger.error('Failed to handle Auto Commit conflict:', error as Error);
        }
    }

    public static async handleCustomEndpointConflict(): Promise<void> {
        try {
            const selection = await vscode.window.showWarningMessage(
                'Custom endpoint is enabled but endpoint URL or model name is not configured.',
                'Configure Endpoint',
                'Disable Custom Endpoint',
                'Open Settings'
            );

            if (selection === 'Configure Endpoint') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.custom.endpoint'
                );
            } else if (selection === 'Disable Custom Endpoint') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('custom.useCustomEndpoint', false, true);
                void Logger.log('Custom Endpoint has been disabled');
            } else if (selection === 'Open Settings') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.custom'
                );
            }
        } catch (error) {
            void Logger.error('Failed to handle Custom Endpoint conflict:', error as Error);
        }
    }

    public static async handleCustomInstructionsConflict(): Promise<void> {
        try {
            const selection = await vscode.window.showWarningMessage(
                'Custom instructions are enabled but not configured.',
                'Configure Instructions',
                'Disable Custom Instructions',
                'Open Settings'
            );

            if (selection === 'Configure Instructions') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.commit.customInstructions'
                );
            } else if (selection === 'Disable Custom Instructions') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.useCustomInstructions', false, true);
                void Logger.log('Custom Instructions have been disabled');
            } else if (selection === 'Open Settings') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'commitSage.commit'
                );
            }
        } catch (error) {
            void Logger.error('Failed to handle Custom Instructions conflict:', error as Error);
        }
    }

    public static async handleRefsPromptConflict(): Promise<void> {
        try {
            const selection = await vscode.window.showWarningMessage(
                'Refs prompt is enabled with Auto Commit. This may interrupt the automatic commit flow.',
                'Disable Refs Prompt',
                'Disable Auto Commit',
                'Continue Anyway'
            );

            if (selection === 'Disable Refs Prompt') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.promptForRefs', false, true);
                void Logger.log('Refs prompt has been disabled');
            } else if (selection === 'Disable Auto Commit') {
                const config = vscode.workspace.getConfiguration('commitSage');
                await config.update('commit.autoCommit', false, true);
                void Logger.log('Auto Commit has been disabled');
            }
        } catch (error) {
            void Logger.error('Failed to handle Refs Prompt conflict:', error as Error);
        }
    }
}