import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockGet, mockGetOptionalKey, mockGetAvailableModels,
    mockShowWarning, mockExecuteCommand, mockUpdate, mockGetConfiguration,
    mockLog,
} = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockGetOptionalKey: vi.fn(),
    mockGetAvailableModels: vi.fn(),
    mockShowWarning: vi.fn(),
    mockExecuteCommand: vi.fn(),
    mockUpdate: vi.fn(),
    mockGetConfiguration: vi.fn(),
    mockLog: vi.fn(),
}));

vi.mock('vscode', () => ({
    l10n: { t: (msg: string, ...args: Array<string | number>) => msg.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])) },
    window: { showWarningMessage: mockShowWarning },
    commands: { executeCommand: mockExecuteCommand },
    workspace: { getConfiguration: mockGetConfiguration },
    ConfigurationTarget: { Global: 1 },
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: { get: mockGet },
}));

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: { getOptionalKey: mockGetOptionalKey },
}));

vi.mock('../src/services/geminiService', () => ({
    GeminiService: { getAvailableModels: mockGetAvailableModels },
}));

vi.mock('../src/utils/logger', () => ({
    Logger: { log: mockLog },
}));

import { validateGeminiModelOnStartup } from '../src/services/geminiModelValidator';

beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfiguration.mockReturnValue({ update: mockUpdate });
    mockGet.mockImplementation((k: string) => {
        if (k === 'provider.type') return 'gemini';
        if (k === 'gemini.model') return 'gemini-old';
        return undefined;
    });
    mockGetOptionalKey.mockResolvedValue('a-key');
    mockGetAvailableModels.mockResolvedValue(['gemini-new']);
});

describe('validateGeminiModelOnStartup early returns', () => {
    it('returns when the provider is not gemini', async () => {
        mockGet.mockImplementation((k: string) => (k === 'provider.type' ? 'openai' : undefined));
        await validateGeminiModelOnStartup();
        expect(mockGetOptionalKey).not.toHaveBeenCalled();
    });

    it('returns when the configured model is "auto"', async () => {
        mockGet.mockImplementation((k: string) => {
            if (k === 'provider.type') return 'gemini';
            if (k === 'gemini.model') return 'auto';
            return undefined;
        });
        await validateGeminiModelOnStartup();
        expect(mockGetOptionalKey).not.toHaveBeenCalled();
    });

    it('returns when there is no API key', async () => {
        mockGetOptionalKey.mockResolvedValue(undefined);
        await validateGeminiModelOnStartup();
        expect(mockGetAvailableModels).not.toHaveBeenCalled();
    });

    it('returns silently when fetching models throws', async () => {
        mockGetAvailableModels.mockRejectedValue(new Error('offline'));
        await validateGeminiModelOnStartup();
        expect(mockShowWarning).not.toHaveBeenCalled();
        expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Skipping Gemini model validation'));
    });

    it('returns when the live list is empty', async () => {
        mockGetAvailableModels.mockResolvedValue([]);
        await validateGeminiModelOnStartup();
        expect(mockShowWarning).not.toHaveBeenCalled();
    });

    it('returns when the configured model is still in the live list', async () => {
        mockGetAvailableModels.mockResolvedValue(['gemini-old', 'gemini-new']);
        await validateGeminiModelOnStartup();
        expect(mockShowWarning).not.toHaveBeenCalled();
    });
});

describe('validateGeminiModelOnStartup prompt actions', () => {
    it('opens settings when the user picks "Pick a model"', async () => {
        mockShowWarning.mockResolvedValue('Pick a model');
        await validateGeminiModelOnStartup();
        expect(mockExecuteCommand).toHaveBeenCalledWith('commitsage.settings.focus');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('switches the model to auto when the user picks "Switch to auto"', async () => {
        mockShowWarning.mockResolvedValue('Switch to auto');
        await validateGeminiModelOnStartup();
        expect(mockUpdate).toHaveBeenCalledWith('commitSage.gemini.model', 'auto', 1);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('does nothing when the warning is dismissed', async () => {
        mockShowWarning.mockResolvedValue(undefined);
        await validateGeminiModelOnStartup();
        expect(mockExecuteCommand).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});
