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
import { installDefaultUiStubs, restoreStubs, stubQuickPick } from '../helpers/vscodeStubs';

describe('Multi-repository workspace', () => {
    let mock: MockLlmServer;
    let baseUrl: string;
    let repoA: TempRepo;
    let repoB: TempRepo;

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
        repoA = await makeTempRepo({ initialCommit: true });
        repoB = await makeTempRepo({ initialCommit: true });
    });

    afterEach(async () => {
        mock.reset();
        restoreStubs();
        await cleanupRepo(repoA);
        await cleanupRepo(repoB);
    });

    it('routes generation to the repo selected via QuickPick', async () => {
        await fs.appendFile(path.join(repoA.path, 'README.md'), '\nA modified\n');
        await git(repoA.path, 'add', 'README.md');
        await fs.appendFile(path.join(repoB.path, 'README.md'), '\nB modified\n');
        await git(repoB.path, 'add', 'README.md');

        // GitService.selectRepository shows QuickPick of {label, description, repository}.
        // Stub returns the second item — selection of repoB. The `repository`
        // value MUST be the real SourceControl from vscode.git so its inputBox
        // is the live one CommitWorkflow writes into.
        const realRepoB = getRepository(repoB.path);
        stubQuickPick({
            label: path.basename(repoB.path),
            description: repoB.path,
            repository: realRepoB,
        });

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        const a = getRepository(repoA.path);
        const b = getRepository(repoB.path);
        assert.equal(b.inputBox.value, 'feat: test commit message');
        assert.equal(a.inputBox.value, '', 'repoA inputBox must remain empty');
    });
});
