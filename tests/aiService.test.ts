import { describe, it, expect, vi, beforeEach } from 'vitest';

const { settings, loadRules, generatePrompt, refinementPrompt, validate, autoFix, generate } = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    loadRules: vi.fn(),
    generatePrompt: vi.fn(),
    refinementPrompt: vi.fn(),
    validate: vi.fn(),
    autoFix: vi.fn(),
    generate: vi.fn(),
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => settings[key],
        getProvider: () => 'openai',
        getModel: () => 'gpt-test',
    },
}));
vi.mock('../src/services/promptService', () => ({
    PromptService: { loadRules, generatePrompt, generateRefinementPrompt: refinementPrompt },
}));
vi.mock('../src/services/commitLintService', () => ({
    CommitLintService: { validate, autoFix },
}));
vi.mock('../src/services/aiServiceFactory', () => ({
    AIServiceFactory: { generateCommitMessage: generate },
}));
vi.mock('../src/services/telemetryService', () => ({
    TelemetryService: { sendEvent: vi.fn() },
}));

import { AIService } from '../src/services/aiService';

const progress = { report: () => undefined };

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(settings, {
        'commit.commitLanguage': 'english',
        'general.maxDiffSize': 100_000,
        'commit.commitlint.enabled': true,
        'commit.commitlint.maxRetries': 3,
        'commit.commitlint.rulesPath': '',
        'commit.commitlint.engine': 'builtin',
    });
    loadRules.mockResolvedValue('RULES');
    generatePrompt.mockResolvedValue('PROMPT');
    refinementPrompt.mockReturnValue('REFINE');
    autoFix.mockImplementation((m: string) => m);
    generate.mockImplementation(async () => ({ message: 'feat: x', model: 'gpt-test' }));
});

describe('AIService commitlint gate', () => {
    it.each(['custom', 'previous'])('skips rules and validation for the %s format', async (format) => {
        settings['commit.commitFormat'] = format;

        await AIService.generateCommitMessage('/repo', 'diff', '', progress);

        expect(loadRules).not.toHaveBeenCalled();
        expect(validate).not.toHaveBeenCalled();
        expect(generatePrompt).toHaveBeenCalledWith('/repo', 'diff', '', progress, '', undefined);
    });

    it('loads rules once with the signal and reuses them for refinement', async () => {
        settings['commit.commitFormat'] = 'conventional';
        const signal = new AbortController().signal;
        validate
            .mockResolvedValueOnce({ valid: false, errors: ['subject-case'] })
            .mockResolvedValueOnce({ valid: true, errors: [] });

        await AIService.generateCommitMessage('/repo', 'diff', '', progress, { signal, draft: 'my draft' });

        expect(loadRules).toHaveBeenCalledOnce();
        expect(loadRules).toHaveBeenCalledWith('/repo', 'conventional', signal);
        expect(generatePrompt).toHaveBeenCalledWith('/repo', 'diff', '', progress, 'RULES', 'my draft');
        expect(refinementPrompt).toHaveBeenCalledWith('feat: x', ['subject-case'], 'RULES');
        expect(generate).toHaveBeenCalledTimes(2);
    });

    it('marks the message for git sign-off when a rule requires it', async () => {
        settings['commit.commitFormat'] = 'conventional';
        validate.mockResolvedValueOnce({ valid: true, errors: [], signOffRequired: true });

        const result = await AIService.generateCommitMessage('/repo', 'diff', '', progress);

        expect(result).toEqual({ message: 'feat: x', model: 'gpt-test', signOff: true });
        expect(refinementPrompt).not.toHaveBeenCalled();
    });

    it('keeps the sign-off flag through a refinement', async () => {
        settings['commit.commitFormat'] = 'conventional';
        validate
            .mockResolvedValueOnce({ valid: false, errors: ['subject-case'], signOffRequired: true })
            .mockResolvedValueOnce({ valid: true, errors: [], signOffRequired: true });

        const result = await AIService.generateCommitMessage('/repo', 'diff', '', progress);

        expect(result.signOff).toBe(true);
        expect(generate).toHaveBeenCalledTimes(2);
    });
});
