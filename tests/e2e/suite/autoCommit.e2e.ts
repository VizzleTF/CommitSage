import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MockLlmServer } from '../helpers/mockLlmServer';
import {
    cleanupRepo,
    git,
    makeTempRepo,
    purgeSampleWorkspace,
    TempRepo,
} from '../helpers/tempRepo';
import {
    activateExtension,
    ensureOpenAIKey,
    resetCommitSettings,
    setProviderToMockOpenAI,
} from '../helpers/settings';
import { installDefaultUiStubs, restoreStubs } from '../helpers/vscodeStubs';

describe('Auto-commit / auto-push', () => {
    let mock: MockLlmServer;
    let baseUrl: string;
    let repo: TempRepo;

    before(async () => {
        await activateExtension();
        await purgeSampleWorkspace();
        mock = new MockLlmServer();
        ({ baseUrl } = await mock.start());
        await setProviderToMockOpenAI(baseUrl);
        await ensureOpenAIKey();
    });

    after(async () => {
        await mock.stop();
        await purgeSampleWorkspace();
    });

    afterEach(async () => {
        mock.reset();
        restoreStubs();
        await cleanupRepo(repo);
    });

    beforeEach(async () => {
        await resetCommitSettings();
        installDefaultUiStubs({ inputBox: 'e2e-test-key' });
    });

    it('creates a real git commit when autoCommit=true', async () => {
        repo = await makeTempRepo({ initialCommit: true });
        await vscode.workspace.getConfiguration('commitSage')
            .update('commit.autoCommit', true, vscode.ConfigurationTarget.Workspace);

        await fs.appendFile(path.join(repo.path, 'README.md'), '\nchanged\n');
        await git(repo.path, 'add', 'README.md');

        const before = (await git(repo.path, 'rev-list', '--count', 'HEAD')).trim();

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        const after = (await git(repo.path, 'rev-list', '--count', 'HEAD')).trim();
        assert.equal(Number(after), Number(before) + 1, `expected one new commit (${before} -> ${after})`);
        const headMsg = (await git(repo.path, 'log', '-1', '--pretty=%s')).trim();
        assert.equal(headMsg, 'feat: test commit message');
    });

    // Auto-push with a bare local remote: stable enough for CI but treat as
    // a separate scenario — the rest of the suite must not be affected if
    // push semantics ever change.
    it('pushes to a bare local remote when autoPush=true', async () => {
        repo = await makeTempRepo({ initialCommit: true, bareRemote: true });
        await vscode.workspace.getConfiguration('commitSage')
            .update('commit.autoCommit', true, vscode.ConfigurationTarget.Workspace);
        await vscode.workspace.getConfiguration('commitSage')
            .update('commit.autoPush', true, vscode.ConfigurationTarget.Workspace);

        await fs.appendFile(path.join(repo.path, 'README.md'), '\nfor push\n');
        await git(repo.path, 'add', 'README.md');

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        // Wait for the push to land on the bare remote (vscode.git push is async).
        const remotePath = repo.remotePath!;
        await waitFor(async () => {
            const count = (await git(remotePath, 'rev-list', '--count', 'main')).trim();
            return Number(count) >= 2;
        }, 15_000);

        const remoteCount = Number((await git(remotePath, 'rev-list', '--count', 'main')).trim());
        assert.ok(remoteCount >= 2, `expected >=2 commits on remote, got ${remoteCount}`);
    });
});

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`waitFor: condition not met in ${timeoutMs}ms`);
}
