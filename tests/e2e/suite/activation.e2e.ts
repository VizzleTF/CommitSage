import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension } from '../helpers/settings';

const EXPECTED_COMMANDS = [
    'commitsage.generateCommitMessage',
    'commitsage.setApiKey',
    'commitsage.setOpenAIApiKey',
    'commitsage.setCodestralApiKey',
    'commitsage.removeApiKey',
    'commitsage.removeOpenAIApiKey',
    'commitsage.removeCodestralApiKey',
    'commitsage.setOllamaAuthToken',
    'commitsage.removeOllamaAuthToken',
    'commitsage.createProjectConfig',
];

describe('Activation', () => {
    before(async () => {
        await activateExtension();
    });

    it('extension is active', async () => {
        const ext = vscode.extensions.getExtension('VizzleTF.geminicommit');
        assert.ok(ext);
        assert.equal(ext.isActive, true);
    });

    it('all contributed commands are registered', async () => {
        const registered = new Set(await vscode.commands.getCommands(true));
        for (const cmd of EXPECTED_COMMANDS) {
            assert.ok(registered.has(cmd), `command ${cmd} is not registered`);
        }
    });

    it('vscode.git built-in extension is available', () => {
        const git = vscode.extensions.getExtension('vscode.git');
        assert.ok(git, 'vscode.git extension missing');
        assert.equal(git.isActive, true);
    });
});
