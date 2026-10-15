import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

const { settings, repo, generate, promptForKey, removeKey, commitChanges } = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    repo: { rootUri: { fsPath: '/repo' }, inputBox: { value: '' } },
    generate: vi.fn(),
    commitChanges: vi.fn(),
    promptForKey: vi.fn(),
    removeKey: vi.fn(),
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => settings[key],
        getProvider: () => settings['provider.type'],
        getModel: () => 'm',
    },
}));
vi.mock('../src/services/gitRepository', () => ({
    GitRepositoryProvider: {
        getActiveRepository: async () => repo,
    },
}));
vi.mock('../src/services/gitService', () => ({
    GitService: {
        getChangedFiles: async () => [{ path: 'a.txt', status: ' M' }],
        getDiff: async () => 'diff',
        getExcludedPaths: async () => new Set(),
        hasHead: async () => false,
        commitChanges,
    },
    isIndexStaged: () => false,
}));
vi.mock('../src/services/aiService', () => ({
    AIService: { generateCommitMessage: generate },
}));
vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: {
        requiresKeyForCurrentConfig: (p: string) =>
            p === 'ollama' ? settings['ollama.useAuthToken'] : p === 'custom' ? settings['custom.useApiKey'] : true,
        getKey: vi.fn(async () => 'key'),
        removeKey,
        promptForKey,
    },
}));
vi.mock('../src/services/telemetryService', () => ({
    TelemetryService: { sendEvent: vi.fn() },
}));

import { CommitWorkflow } from '../src/services/commitWorkflow';
import { ApiKeyInvalidError } from '../src/models/errors';
import { NetworkError } from '../src/utils/httpUtils';

beforeEach(() => {
    vi.restoreAllMocks();
    generate.mockReset();
    promptForKey.mockReset();
    removeKey.mockReset();
    commitChanges.mockReset();
    repo.inputBox.value = '';
    Object.assign(settings, {
        'provider.type': 'ollama',
        'ollama.useAuthToken': false,
        'custom.useApiKey': false,
        'commit.refs.enabled': false,
        'commit.onlyStagedChanges': false,
        'commit.autoCommit': false,
    });
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: '/repo' } }];
    generate.mockRejectedValue(new ApiKeyInvalidError('Ollama'));
});

describe('CommitWorkflow on a 401', () => {
    it('does not ask for a token the provider would not send', async () => {
        const showError = vi.spyOn(vscode.window, 'showErrorMessage');

        await CommitWorkflow.generateAndSetCommitMessage();

        expect(promptForKey).not.toHaveBeenCalled();
        expect(removeKey).not.toHaveBeenCalled();
        expect(generate).toHaveBeenCalledOnce();
        expect(showError).toHaveBeenCalledWith(expect.stringContaining('commitSage.ollama.useAuthToken'), 'Show Log');
    });

    it('asks for a new key when the key is sent', async () => {
        settings['ollama.useAuthToken'] = true;
        promptForKey.mockResolvedValue('new');
        generate.mockRejectedValueOnce(new ApiKeyInvalidError('Ollama')).mockResolvedValueOnce({ message: 'feat: x', model: 'm' });

        await CommitWorkflow.generateAndSetCommitMessage();

        expect(removeKey).toHaveBeenCalledWith('ollama');
        expect(promptForKey).toHaveBeenCalledWith('ollama');
        expect(generate).toHaveBeenCalledTimes(2);
    });
});

describe('CommitWorkflow auto-commit', () => {
    it('asks git to sign off when the commitlint rules require it', async () => {
        settings['commit.autoCommit'] = true;
        generate.mockReset().mockResolvedValue({ message: 'feat: x', model: 'm', signOff: true });

        await CommitWorkflow.generateAndSetCommitMessage();

        expect(commitChanges).toHaveBeenCalledWith('feat: x', '/repo', true, true);
    });
});

describe('CommitWorkflow commit box draft', () => {
    const draftOf = (call: number) => (generate.mock.calls[call][4] as { draft: string }).draft;

    it('sends what the developer typed as the draft', async () => {
        repo.inputBox.value = '  fix login for SSO users\n';
        generate.mockReset().mockResolvedValue({ message: 'fix(auth): accept SSO logins', model: 'm' });

        await CommitWorkflow.generateAndSetCommitMessage();

        expect(draftOf(0)).toBe('fix login for SSO users');
        expect(repo.inputBox.value).toBe('fix(auth): accept SSO logins');
    });

    it('passes its own previous message as rejected, not as a draft', async () => {
        generate.mockReset().mockResolvedValue({ message: 'feat(ui): add dark theme', model: 'm' });

        await CommitWorkflow.generateAndSetCommitMessage();
        await CommitWorkflow.generateAndSetCommitMessage();

        expect(draftOf(1)).toBe('');
        expect((generate.mock.calls[1][4] as { rejected: string }).rejected).toBe('feat(ui): add dark theme');
    });

    it('sends no draft for an empty box', async () => {
        repo.inputBox.value = ' \n ';
        generate.mockReset().mockResolvedValue({ message: 'chore: x', model: 'm' });

        await CommitWorkflow.generateAndSetCommitMessage();

        expect(draftOf(0)).toBe('');
    });

    it('leaves the draft in the box when generation fails', async () => {
        repo.inputBox.value = 'my draft';
        generate.mockReset().mockRejectedValue(new Error('boom'));

        await CommitWorkflow.generateAndSetCommitMessage();

        expect(repo.inputBox.value).toBe('my draft');
    });
});

describe('CommitWorkflow concurrent runs', () => {
    it('does not start a second run while the repository is still generating', async () => {
        let finish!: (value: unknown) => void;
        generate.mockReset().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const info = vi.spyOn(vscode.window, 'showInformationMessage');
        const exec = vi.spyOn(vscode.commands, 'executeCommand');

        const first = CommitWorkflow.generateAndSetCommitMessage();
        await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
        await CommitWorkflow.generateAndSetCommitMessage();

        expect(generate).toHaveBeenCalledOnce();
        expect(info).toHaveBeenCalledWith(expect.stringContaining('already generating'));
        expect(exec).toHaveBeenCalledWith('setContext', 'commitsage.generatingRepos', [String(repo.rootUri)]);

        finish({ message: 'feat: x', model: 'm' });
        await first;
        expect(exec).toHaveBeenLastCalledWith('setContext', 'commitsage.generatingRepos', []);

        generate.mockResolvedValueOnce({ message: 'feat: y', model: 'm' });
        await CommitWorkflow.generateAndSetCommitMessage();
        expect(generate).toHaveBeenCalledTimes(2);
    });
});

describe('CommitWorkflow error notifications', () => {
    it('offers the settings for a connection error', async () => {
        generate.mockReset().mockRejectedValue(new Error('Failed', { cause: new NetworkError('ECONNREFUSED', null) }));
        const showError = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('Open Settings' as never);
        const exec = vi.spyOn(vscode.commands, 'executeCommand');

        await CommitWorkflow.generateAndSetCommitMessage();

        expect(showError).toHaveBeenCalledWith(expect.any(String), 'Open Settings', 'Show Log');
        expect(exec).toHaveBeenCalledWith('workbench.action.openSettings', 'commitSage');
    });

    it('offers the provider key command once the key retries run out', async () => {
        const showError = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('Set API Key' as never);
        const exec = vi.spyOn(vscode.commands, 'executeCommand');

        await CommitWorkflow.generateAndSetCommitMessage(undefined, 3);

        expect(showError).toHaveBeenCalledWith(expect.stringContaining('Maximum retry'), 'Set API Key', 'Show Log');
        expect(exec).toHaveBeenCalledWith('commitsage.setOllamaAuthToken');
    });

    it('offers only the log for other errors', async () => {
        generate.mockReset().mockRejectedValue(new Error('boom'));
        const showError = vi.spyOn(vscode.window, 'showErrorMessage');

        await CommitWorkflow.generateAndSetCommitMessage();

        expect(showError).toHaveBeenCalledWith('Commit Sage: boom', 'Show Log');
    });
});
