import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MockLlmServer } from '../helpers/mockLlmServer';
import { cleanupRepo, git, makeTempRepo, purgeSampleWorkspace, TempRepo } from '../helpers/tempRepo';
import { activateExtension, ensureOpenAIKey, resetCommitSettings, setProviderToMockOpenAI } from '../helpers/settings';
import { installDefaultUiStubs, restoreStubs, stubInformation } from '../helpers/vscodeStubs';

const reply = (content: string) => ({ body: { choices: [{ message: { content } }] } });

describe('Split changes into commits', () => {
    let mock: MockLlmServer;
    let repo: TempRepo;

    before(async () => {
        await activateExtension();
        await purgeSampleWorkspace();
        mock = new MockLlmServer();
        const { baseUrl } = await mock.start();
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

    it('commits each group of files with its own message after confirmation', async () => {
        await fs.writeFile(path.join(repo.path, 'a.txt'), 'a\n');
        await fs.writeFile(path.join(repo.path, 'b.txt'), 'b\n');
        mock.enqueue(reply('1 a.txt\n2 b.txt'), reply('feat: add a'), reply('docs: add b'));
        stubInformation().callsFake(async (_msg: string, options?: { modal?: boolean }) => (options?.modal ? 'Commit' : undefined));

        await vscode.commands.executeCommand('commitsage.splitCommits');

        const log = (await git(repo.path, 'log', '--format=%s', '--name-only', '-2')).trim();
        assert.equal(log, 'docs: add b\n\nb.txt\nfeat: add a\n\na.txt');
        assert.equal((await git(repo.path, 'status', '--porcelain')).trim(), '');
    });

    it('creates no commit when the plan is not confirmed', async () => {
        await fs.writeFile(path.join(repo.path, 'a.txt'), 'a\n');
        await fs.writeFile(path.join(repo.path, 'b.txt'), 'b\n');
        mock.enqueue(reply('1 a.txt\n2 b.txt'), reply('feat: add a'), reply('docs: add b'));
        const before = (await git(repo.path, 'rev-list', '--count', 'HEAD')).trim();

        await vscode.commands.executeCommand('commitsage.splitCommits');

        assert.equal((await git(repo.path, 'rev-list', '--count', 'HEAD')).trim(), before);
    });
});
