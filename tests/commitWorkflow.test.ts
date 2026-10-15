import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

const { settings, generate, promptForKey, removeKey } = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    generate: vi.fn(),
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
        getActiveRepository: async () => ({ rootUri: { fsPath: '/repo' }, inputBox: { value: '' } }),
    },
}));
vi.mock('../src/services/gitService', () => ({
    GitService: {
        getChangedFiles: async () => [{ path: 'a.txt', status: ' M' }],
        getDiff: async () => 'diff',
        hasHead: async () => false,
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
