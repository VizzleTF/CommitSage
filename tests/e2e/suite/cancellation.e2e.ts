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
import { installDefaultUiStubs, restoreStubs, stubWithProgressCancellable } from '../helpers/vscodeStubs';

describe('Cancellation', () => {
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
        await fs.appendFile(path.join(repo.path, 'README.md'), '\nfor cancel\n');
        await git(repo.path, 'add', 'README.md');
    });

    afterEach(async () => {
        mock.reset();
        restoreStubs();
        await cleanupRepo(repo);
    });

    it('cancels via progress token before LLM responds', async () => {
        // The mock takes 5 seconds to respond, but we cancel after 50ms.
        mock.enqueue({ delayMs: 5_000 });
        stubWithProgressCancellable(50);

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        const r = getRepository(repo.path);
        assert.equal(r.inputBox.value, '', 'inputBox must remain empty after cancellation');
        // We may still see the request hit the server (cancel races the in-flight fetch),
        // but only zero or one — never the retry chain.
        assert.ok(mock.requests.length <= 1,
            `cancel should prevent retries, got ${mock.requests.length} requests`);
    });
});
