import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MockLlmServer } from '../helpers/mockLlmServer';
import {
    cleanupRepo,
    getRepository,
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

describe('Commit message generation', () => {
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

    beforeEach(async () => {
        await resetCommitSettings();
        installDefaultUiStubs({ inputBox: 'e2e-test-key' });
        repo = await makeTempRepo({ initialCommit: true });
    });

    afterEach(async () => {
        mock.reset();
        restoreStubs();
        await cleanupRepo(repo);
    });

    it('writes generated message into SCM input box (modified + staged file)', async () => {
        const file = path.join(repo.path, 'README.md');
        await fs.appendFile(file, '\nmodified\n');
        await git(repo.path, 'add', 'README.md');

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        const r = getRepository(repo.path);
        assert.equal(r.inputBox.value, 'feat: test commit message');

        assert.equal(mock.requests.length, 1);
        const body = mock.requests[0].body as { messages: { content: string }[] };
        assert.ok(body.messages?.[0]?.content?.includes('README.md'),
            `prompt should contain README.md, got: ${body.messages?.[0]?.content?.slice(0, 200)}`);
    });

    it('auto-stages and commits an untracked file when autoCommit is on', async () => {
        await vscode.workspace.getConfiguration('commitSage')
            .update('commit.autoCommit', true, vscode.ConfigurationTarget.Workspace);

        await fs.writeFile(path.join(repo.path, 'NEW.txt'), 'hello\n');

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        const log = await git(repo.path, 'log', '--oneline');
        assert.ok(log.split('\n').filter(Boolean).length >= 2,
            `expected >=2 commits after autoCommit, log:\n${log}`);
        const headMsg = (await git(repo.path, 'log', '-1', '--pretty=%s')).trim();
        assert.equal(headMsg, 'feat: test commit message');
    });

    it('handles deleted file (autoCommit on)', async () => {
        await vscode.workspace.getConfiguration('commitSage')
            .update('commit.autoCommit', true, vscode.ConfigurationTarget.Workspace);

        await fs.rm(path.join(repo.path, 'README.md'));

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        const status = (await git(repo.path, 'status', '--porcelain')).trim();
        assert.equal(status, '', `expected clean working tree, got:\n${status}`);
    });

    it('staged-only mode excludes unstaged file from prompt', async () => {
        await vscode.workspace.getConfiguration('commitSage')
            .update('commit.onlyStagedChanges', true, vscode.ConfigurationTarget.Workspace);

        await fs.writeFile(path.join(repo.path, 'staged.txt'), 'staged content\n');
        await git(repo.path, 'add', 'staged.txt');
        await fs.writeFile(path.join(repo.path, 'unstaged.txt'), 'unstaged content\n');

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        assert.equal(mock.requests.length, 1);
        const prompt = (mock.requests[0].body as { messages: { content: string }[] })
            .messages[0].content;
        assert.ok(prompt.includes('staged.txt'), 'prompt should include staged.txt');
        assert.ok(!prompt.includes('unstaged.txt'),
            `prompt should NOT include unstaged.txt, got fragment:\n${prompt}`);
    });
});
