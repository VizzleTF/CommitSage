import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { ProjectConfig } from '../models/types';

export class SettingsValidator {
    static async validateAllSettings(): Promise<void> {
        await this.validateProjectConfig();
        await this.validateAutoPushState();
        await this.validateCustomInstructions();
        await this.validateRefsWithAutoCommit();
    }

    static async validateProjectConfig(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const configPath = path.join(workspaceFolder.uri.fsPath, '.commitsage');

        if (!fs.existsSync(configPath)) {
            return;
        }

        try {
            const configContent = fs.readFileSync(configPath, 'utf8');
            JSON.parse(configContent) as ProjectConfig;
            void Logger.log('Project configuration (.commitsage) validated successfully');
        } catch (error) {
            const selection = await vscode.window.showErrorMessage(
                'Invalid .commitsage configuration file. The file contains syntax errors.',
                {
                    modal: true,
                    detail: 'The project configuration file has JSON syntax errors that prevent it from being loaded.'
                },
                { title: 'Open File', isCloseAffordance: false },
                { title: 'Ignore', isCloseAffordance: true }
            );

            if (selection?.title === 'Open File') {
                const uri = vscode.Uri.file(configPath);
                void vscode.window.showTextDocument(uri);
            }

            void Logger.error('Error validating .commitsage file:', error as Error);
        }
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
}
