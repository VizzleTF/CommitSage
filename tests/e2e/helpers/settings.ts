import * as vscode from 'vscode';
import { stubInputBox } from './vscodeStubs';

const EXTENSION_ID = 'VizzleTF.geminicommit';

export async function activateExtension(): Promise<vscode.Extension<unknown>> {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (!ext) throw new Error(`Extension ${EXTENSION_ID} not found`);
    if (!ext.isActive) await ext.activate();
    return ext;
}

export async function setProviderToMockOpenAI(baseUrl: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('commitSage');
    await cfg.update('provider.type', 'openai', vscode.ConfigurationTarget.Workspace);
    await cfg.update('openai.baseUrl', baseUrl, vscode.ConfigurationTarget.Workspace);
    await cfg.update('telemetry.enabled', false, vscode.ConfigurationTarget.Workspace);
}

export async function resetCommitSettings(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('commitSage');
    await cfg.update('commit.autoCommit', false, vscode.ConfigurationTarget.Workspace);
    await cfg.update('commit.autoPush', false, vscode.ConfigurationTarget.Workspace);
    await cfg.update('commit.onlyStagedChanges', false, vscode.ConfigurationTarget.Workspace);
}

export async function ensureOpenAIKey(key = 'e2e-test-key'): Promise<void> {
    // Direct use of `secrets` from another extension's context isn't accessible.
    // We trigger the registered command and stub showInputBox to feed the key.
    // Uses the shared sandbox so it cooperates with installDefaultUiStubs.
    stubInputBox(key);
    await vscode.commands.executeCommand('commitsage.setOpenAIApiKey');
}

export async function clearOpenAIKey(): Promise<void> {
    await vscode.commands.executeCommand('commitsage.removeOpenAIApiKey');
}
