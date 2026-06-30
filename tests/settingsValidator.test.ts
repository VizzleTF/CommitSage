import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockGet, mockHasValidProjectConfig, mockShowWarning,
    mockLog, mockError,
    mockShowErrorMessage, mockShowTextDocument, mockExecuteCommand,
    mockUpdate, mockGetConfiguration,
} = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockHasValidProjectConfig: vi.fn(),
    mockShowWarning: vi.fn(),
    mockLog: vi.fn(),
    mockError: vi.fn(),
    mockShowErrorMessage: vi.fn(),
    mockShowTextDocument: vi.fn(),
    mockExecuteCommand: vi.fn(),
    mockUpdate: vi.fn(),
    mockGetConfiguration: vi.fn(),
}));

vi.mock('vscode', () => ({
    l10n: { t: (msg: string, ...a: Array<string | number>) => msg.replace(/\{(\d+)\}/g, (_, i) => String(a[Number(i)])) },
    window: { showErrorMessage: mockShowErrorMessage, showTextDocument: mockShowTextDocument },
    commands: { executeCommand: mockExecuteCommand },
    workspace: { getConfiguration: mockGetConfiguration },
    Uri: { file: (p: string) => ({ fsPath: p }) },
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: { get: mockGet, hasValidProjectConfig: mockHasValidProjectConfig },
}));

vi.mock('../src/utils/logger', () => ({
    Logger: { log: mockLog, error: mockError, showWarning: mockShowWarning },
}));

import { SettingsValidator } from '../src/services/settingsValidator';

beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfiguration.mockReturnValue({ update: mockUpdate });
    mockGet.mockReturnValue(undefined);
    mockHasValidProjectConfig.mockResolvedValue({ valid: true });
    mockShowWarning.mockResolvedValue(undefined);
    mockShowErrorMessage.mockResolvedValue(undefined);
});

describe('validateProjectConfig', () => {
    it('logs success when valid with a configPath', async () => {
        mockHasValidProjectConfig.mockResolvedValue({ valid: true, configPath: '/x/config.json' });
        await SettingsValidator.validateProjectConfig();
        expect(mockLog).toHaveBeenCalled();
        expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('returns quietly when valid without a configPath', async () => {
        mockHasValidProjectConfig.mockResolvedValue({ valid: true });
        await SettingsValidator.validateProjectConfig();
        expect(mockLog).not.toHaveBeenCalled();
    });

    it('shows an error and opens the file when the user clicks Open File', async () => {
        mockHasValidProjectConfig.mockResolvedValue({ valid: false, configPath: '/x/config.json', error: new Error('bad') });
        mockShowErrorMessage.mockResolvedValue({ title: 'Open File' });
        await SettingsValidator.validateProjectConfig();
        expect(mockError).toHaveBeenCalled();
        expect(mockShowTextDocument).toHaveBeenCalledWith({ fsPath: '/x/config.json' });
    });

    it('does not open a file when the user ignores', async () => {
        mockHasValidProjectConfig.mockResolvedValue({ valid: false, configPath: '/x/config.json' });
        mockShowErrorMessage.mockResolvedValue({ title: 'Ignore' });
        await SettingsValidator.validateProjectConfig();
        expect(mockShowTextDocument).not.toHaveBeenCalled();
        // error path with no explicit error uses the fallback Error
        expect(mockError).toHaveBeenCalledWith('Error validating .commitsage file:', expect.any(Error));
    });

    it('does not open a file when Open File chosen but no configPath', async () => {
        mockHasValidProjectConfig.mockResolvedValue({ valid: false });
        mockShowErrorMessage.mockResolvedValue({ title: 'Open File' });
        await SettingsValidator.validateProjectConfig();
        expect(mockShowTextDocument).not.toHaveBeenCalled();
    });
});

describe('validateAutoPushState', () => {
    const cfg = (autoPush: boolean, autoCommit: boolean) =>
        mockGet.mockImplementation((k: string) => {
            if (k === 'commit.autoPush') return autoPush;
            if (k === 'commit.autoCommit') return autoCommit;
            return undefined;
        });

    it('does nothing when autoPush is off', async () => {
        cfg(false, false);
        await SettingsValidator.validateAutoPushState();
        expect(mockShowWarning).not.toHaveBeenCalled();
    });

    it('does nothing when both are on', async () => {
        cfg(true, true);
        await SettingsValidator.validateAutoPushState();
        expect(mockShowWarning).not.toHaveBeenCalled();
    });

    it('enables auto commit on that choice', async () => {
        cfg(true, false);
        mockShowWarning.mockResolvedValue('Enable Auto Commit');
        await SettingsValidator.validateAutoPushState();
        expect(mockUpdate).toHaveBeenCalledWith('commit.autoCommit', true, true);
    });

    it('disables auto push on that choice', async () => {
        cfg(true, false);
        mockShowWarning.mockResolvedValue('Disable Auto Push');
        await SettingsValidator.validateAutoPushState();
        expect(mockUpdate).toHaveBeenCalledWith('commit.autoPush', false, true);
    });

    it('opens settings on that choice', async () => {
        cfg(true, false);
        mockShowWarning.mockResolvedValue('Open Settings');
        await SettingsValidator.validateAutoPushState();
        expect(mockExecuteCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'commitSage.commit');
    });

    it('does nothing on dismissal', async () => {
        cfg(true, false);
        mockShowWarning.mockResolvedValue(undefined);
        await SettingsValidator.validateAutoPushState();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
});

describe('validateCustomInstructions', () => {
    it('warns when enabled but instructions are blank', async () => {
        mockGet.mockImplementation((k: string) => {
            if (k === 'commit.useCustomInstructions') return true;
            if (k === 'commit.customInstructions') return '   ';
            return undefined;
        });
        await SettingsValidator.validateCustomInstructions();
        expect(mockShowWarning).toHaveBeenCalled();
    });

    it('does nothing when instructions are present', async () => {
        mockGet.mockImplementation((k: string) => {
            if (k === 'commit.useCustomInstructions') return true;
            if (k === 'commit.customInstructions') return 'do stuff';
            return undefined;
        });
        await SettingsValidator.validateCustomInstructions();
        expect(mockShowWarning).not.toHaveBeenCalled();
    });

    it('does nothing when disabled', async () => {
        mockGet.mockImplementation((k: string) => {
            if (k === 'commit.useCustomInstructions') return false;
            if (k === 'commit.customInstructions') return '';
            return undefined;
        });
        await SettingsValidator.validateCustomInstructions();
        expect(mockShowWarning).not.toHaveBeenCalled();
    });
});

describe('validateRefsWithAutoCommit', () => {
    const cfg = (autoCommit: boolean, refsPrompt: boolean) =>
        mockGet.mockImplementation((k: string) => {
            if (k === 'commit.autoCommit') return autoCommit;
            if (k === 'commit.refs.enabled') return refsPrompt;
            if (k === 'commit.refs.source') return 'prompt';
            return undefined;
        });

    it('does nothing when not both enabled', async () => {
        cfg(true, false);
        await SettingsValidator.validateRefsWithAutoCommit();
        expect(mockShowWarning).not.toHaveBeenCalled();
    });

    it('disables refs prompt on that choice', async () => {
        cfg(true, true);
        mockShowWarning.mockResolvedValue('Disable Refs Prompt');
        await SettingsValidator.validateRefsWithAutoCommit();
        expect(mockUpdate).toHaveBeenCalledWith('commit.refs.enabled', false, true);
    });

    it('disables auto commit on that choice', async () => {
        cfg(true, true);
        mockShowWarning.mockResolvedValue('Disable Auto Commit');
        await SettingsValidator.validateRefsWithAutoCommit();
        expect(mockUpdate).toHaveBeenCalledWith('commit.autoCommit', false, true);
    });

    it('keeps both on that choice', async () => {
        cfg(true, true);
        mockShowWarning.mockResolvedValue('Keep Both');
        await SettingsValidator.validateRefsWithAutoCommit();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalledWith('User chose to keep both Auto Commit and Refs prompt enabled');
    });

    it('does nothing on dismissal', async () => {
        cfg(true, true);
        mockShowWarning.mockResolvedValue(undefined);
        await SettingsValidator.validateRefsWithAutoCommit();
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});

describe('validateAllSettings', () => {
    it('runs all validators', async () => {
        mockGet.mockReturnValue(undefined);
        await SettingsValidator.validateAllSettings();
        expect(mockHasValidProjectConfig).toHaveBeenCalled();
    });
});
