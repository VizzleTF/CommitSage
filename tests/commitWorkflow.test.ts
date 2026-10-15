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
        expect(showError).toHaveBeenCalledWith(expect.stringContaining('commitSage.ollama.useAuthToken'));
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

    it('does not take its own previous message for a draft', async () => {
        generate.mockReset().mockResolvedValue({ message: 'feat(ui): add dark theme', model: 'm' });

        await CommitWorkflow.generateAndSetCommitMessage();
        await CommitWorkflow.generateAndSetCommitMessage();

        expect(draftOf(1)).toBe('');
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
