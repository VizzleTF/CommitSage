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
    clearOpenAIKey,
    ensureOpenAIKey,
    resetCommitSettings,
    setProviderToMockOpenAI,
} from '../helpers/settings';
import { installDefaultUiStubs, restoreStubs, stubInputBox } from '../helpers/vscodeStubs';

describe('LLM errors and recovery', () => {
    let mock: MockLlmServer;
    let baseUrl: string;
    let repo: TempRepo;

    before(async () => {
        await activateExtension();
        await purgeSampleWorkspace();
        mock = new MockLlmServer();
        ({ baseUrl } = await mock.start());
        await setProviderToMockOpenAI(baseUrl);
    });

    after(async () => {
        await mock.stop();
        await purgeSampleWorkspace();
    });

    beforeEach(async () => {
        await resetCommitSettings();
        installDefaultUiStubs({ inputBox: 'e2e-test-key' });
        repo = await makeTempRepo({ initialCommit: true });
        await fs.appendFile(path.join(repo.path, 'README.md'), '\nchanged\n');
        await git(repo.path, 'add', 'README.md');
    });

    afterEach(async () => {
        mock.reset();
        restoreStubs();
        await cleanupRepo(repo);
    });

    it('retries on 429 and eventually succeeds', async function () {
        // RetryUtils backs off 1s + 2s between attempts (MAX_RETRIES=3).
        this.timeout(30_000);
        await ensureOpenAIKey();
        mock.enqueue({ status: 429 }, { status: 429 }); // third request falls through to default 200

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        assert.equal(mock.requests.length, 3, `expected 3 requests, got ${mock.requests.length}`);
        const r = getRepository(repo.path);
        assert.equal(r.inputBox.value, 'feat: test commit message');
    });

    it('on 401 prompts for a new key and retries', async () => {
        await ensureOpenAIKey('initial-key');
        mock.enqueue({ status: 401 }); // second request will be served by default 200

        // Default error stub is already installed by installDefaultUiStubs.
        // Override the input box to return the new key when reprompted.
        stubInputBox('new-fixed-key');

        await vscode.commands.executeCommand('commitsage.generateCommitMessage');

        const r = getRepository(repo.path);
        assert.equal(r.inputBox.value, 'feat: test commit message');
        assert.ok(mock.requests.length >= 2, `expected at least 2 requests, got ${mock.requests.length}`);
        const lastAuth = String(mock.requests[mock.requests.length - 1].headers.authorization ?? '');
        assert.ok(lastAuth.includes('new-fixed-key'),
            `last request should carry the new key, got "${lastAuth}"`);

        // Cleanup: drop the test key so the next test re-installs cleanly.
        await clearOpenAIKey();
    });
});
