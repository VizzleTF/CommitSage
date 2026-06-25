import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Drive vscode.window.showInputBox / l10n through a controllable mock so we can
// exercise the prompt branches of ApiKeyManager. SecretStorage is supplied by
// the test as a plain in-memory object.
const showInputBox = vi.fn();

vi.mock('vscode', () => ({
    window: {
        showInputBox: (...args: unknown[]) => showInputBox(...args),
        showErrorMessage: vi.fn(async () => undefined),
        createOutputChannel: () => ({
            appendLine: () => undefined,
            append: () => undefined,
            show: () => undefined,
            dispose: () => undefined,
            trace: () => undefined,
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
            logLevel: 0,
            onDidChangeLogLevel: () => ({ dispose: () => undefined }),
        }),
    },
    l10n: {
        t: (message: string, ...a: Array<string | number>): string =>
            message.replace(/\{(\d+)\}/g, (_, i) => String(a[Number(i)] ?? '')),
    },
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: { get: () => false },
}));

import { ApiKeyManager } from '../src/services/apiKeyManager';
import {
    AiServiceError,
    ConfigurationError,
    UserCancelledError,
} from '../src/models/errors';

type SecretStore = Record<string, string>;

function makeSecretStorage(initial: SecretStore = {}) {
    const store: SecretStore = { ...initial };
    return {
        store,
        get: vi.fn(async (k: string) => store[k]),
        set: vi.fn(async (k: string, v: string) => {
            store[k] = v;
        }),
        delete: vi.fn(async (k: string) => {
            delete store[k];
        }),
        onDidChange: vi.fn((_l: unknown) => ({ dispose: () => undefined })),
    };
}

function installSecretStorage(secrets: ReturnType<typeof makeSecretStorage>): {
    listener?: (e: { key: string }) => void;
    subscriptions: unknown[];
} {
    const subscriptions: unknown[] = [];
    const captured: { listener?: (e: { key: string }) => void } = {};
    secrets.onDidChange.mockImplementation((l: (e: { key: string }) => void) => {
        captured.listener = l;
        return { dispose: () => undefined };
    });
    const secretStorage = {
        get: secrets.get,
        store: secrets.set,
        delete: secrets.delete,
        onDidChange: secrets.onDidChange,
    } as unknown as import('vscode').SecretStorage;
    const context = { subscriptions } as unknown as import('vscode').ExtensionContext;
    ApiKeyManager.initialize(secretStorage, context);
    return { ...captured, subscriptions };
}

beforeEach(() => {
    showInputBox.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ApiKeyManager.initialize', () => {
    it('registers an onDidChange listener that logs known key updates', () => {
        const secrets = makeSecretStorage();
        const ctx = installSecretStorage(secrets);
        expect(ctx.subscriptions.length).toBe(1);
        // Known key -> logs; unknown key -> ignored. Both must not throw.
        ctx.listener?.({ key: 'commitsage.openaiApiKey' });
        ctx.listener?.({ key: 'some.unrelated.key' });
    });
});

describe('ApiKeyManager.getConfig (via public methods)', () => {
    it('throws ConfigurationError for an unknown provider', async () => {
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        await expect(ApiKeyManager.removeKey('does-not-exist')).rejects.toBeInstanceOf(
            ConfigurationError,
        );
    });
});

describe('ApiKeyManager.getKey', () => {
    it('returns an existing stored key without prompting', async () => {
        const secrets = makeSecretStorage({ 'commitsage.openaiApiKey': 'stored-key' });
        installSecretStorage(secrets);
        const key = await ApiKeyManager.getKey('openai');
        expect(key).toBe('stored-key');
        expect(showInputBox).not.toHaveBeenCalled();
    });

    it('prompts, validates, and stores the key when none exists', async () => {
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        showInputBox.mockResolvedValue('sk-newkey');
        const key = await ApiKeyManager.getKey('openai');
        expect(key).toBe('sk-newkey');
        // setKey persisted it.
        expect(secrets.set).toHaveBeenCalledWith('commitsage.openaiApiKey', 'sk-newkey');
    });

    it('throws UserCancelledError when the prompt is dismissed', async () => {
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        showInputBox.mockResolvedValue(undefined);
        await expect(ApiKeyManager.getKey('openai')).rejects.toBeInstanceOf(
            UserCancelledError,
        );
    });

    it('wraps unexpected secretStorage errors in AiServiceError', async () => {
        const secrets = makeSecretStorage();
        secrets.get.mockRejectedValueOnce(new Error('storage boom'));
        installSecretStorage(secrets);
        await expect(ApiKeyManager.getKey('openai')).rejects.toBeInstanceOf(
            AiServiceError,
        );
    });

    it('re-throws an AiServiceError from setKey unchanged (validation fail on prompt)', async () => {
        // gemini uses strict charset validation; a key with invalid chars makes
        // setKey throw AiServiceError, which getKey must re-throw as-is.
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        showInputBox.mockResolvedValue('bad key with spaces');
        await expect(ApiKeyManager.getKey('gemini')).rejects.toBeInstanceOf(
            AiServiceError,
        );
    });
});

describe('ApiKeyManager.setKey', () => {
    it('stores a valid key', async () => {
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        await ApiKeyManager.setKey('openai', 'sk-valid');
        expect(secrets.store['commitsage.openaiApiKey']).toBe('sk-valid');
    });

    it('throws AiServiceError when validation fails', async () => {
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        // gemini strict format rejects spaces.
        await expect(ApiKeyManager.setKey('gemini', 'has space')).rejects.toBeInstanceOf(
            AiServiceError,
        );
    });

    it('surfaces and re-throws a non-AiServiceError from secretStorage.store', async () => {
        const secrets = makeSecretStorage();
        secrets.set.mockRejectedValueOnce(new Error('store failed'));
        installSecretStorage(secrets);
        await expect(ApiKeyManager.setKey('openai', 'sk-ok')).rejects.toThrow(
            'store failed',
        );
    });
});

describe('ApiKeyManager.removeKey', () => {
    it('deletes the stored key', async () => {
        const secrets = makeSecretStorage({ 'commitsage.openaiApiKey': 'x' });
        installSecretStorage(secrets);
        await ApiKeyManager.removeKey('openai');
        expect(secrets.delete).toHaveBeenCalledWith('commitsage.openaiApiKey');
    });

    it('re-throws an error from secretStorage.delete', async () => {
        const secrets = makeSecretStorage();
        secrets.delete.mockRejectedValueOnce(new Error('delete failed'));
        installSecretStorage(secrets);
        await expect(ApiKeyManager.removeKey('openai')).rejects.toThrow('delete failed');
    });
});

describe('ApiKeyManager.getOptionalKey', () => {
    it('returns the stored key', async () => {
        const secrets = makeSecretStorage({ 'commitsage.ollamaAuthToken': 'tok' });
        installSecretStorage(secrets);
        expect(await ApiKeyManager.getOptionalKey('ollama')).toBe('tok');
    });

    it('returns undefined when not stored', async () => {
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        expect(await ApiKeyManager.getOptionalKey('ollama')).toBeUndefined();
    });

    it('returns undefined (swallows) on storage error', async () => {
        const secrets = makeSecretStorage();
        secrets.get.mockRejectedValueOnce(new Error('read boom'));
        installSecretStorage(secrets);
        expect(await ApiKeyManager.getOptionalKey('ollama')).toBeUndefined();
    });
});

describe('ApiKeyManager.promptForKey', () => {
    it('prompts and stores a valid key', async () => {
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        showInputBox.mockResolvedValue('sk-prompted');
        await ApiKeyManager.promptForKey('openai');
        expect(secrets.store['commitsage.openaiApiKey']).toBe('sk-prompted');
    });

    it('throws UserCancelledError when dismissed', async () => {
        const secrets = makeSecretStorage();
        installSecretStorage(secrets);
        showInputBox.mockResolvedValue(undefined);
        await expect(ApiKeyManager.promptForKey('openai')).rejects.toBeInstanceOf(
            UserCancelledError,
        );
    });
});
