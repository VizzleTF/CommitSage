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
    PromptService: {
        loadRules, generatePrompt, generateRefinementPrompt: refinementPrompt,
        generateChunkSummaryPrompt: (chunk: string) => `SUMMARIZE ${chunk.length}`,
    },
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
        expect(generatePrompt).toHaveBeenCalledWith('/repo', 'diff', '', progress, { rules: '', draft: undefined, rejected: undefined, summaries: undefined, signal: undefined });
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
        expect(generatePrompt).toHaveBeenCalledWith('/repo', 'diff', '', progress, { rules: 'RULES', draft: 'my draft', rejected: undefined, summaries: undefined, signal });
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

describe('AIService large diff summaries', () => {
    const block = (path: string) => `diff --git a/${path} b/${path}\n${'+line\n'.repeat(150)}`;
    const diff = block('src/a.ts') + block('src/b.ts') + block('package-lock.json');

    beforeEach(() => {
        Object.assign(settings, { 'commit.commitFormat': 'custom', 'general.maxDiffSize': 1000 });
    });

    it('summarizes an over-budget diff in parts and prompts with the summaries', async () => {
        settings['general.summarizeLargeDiffs'] = true;
        generate.mockImplementation(async (_p: string, prompt: string) => ({
            message: prompt.startsWith('SUMMARIZE') ? 'Here are the bullets:\n\n- part' : 'feat: x', model: 'gpt-test',
        }));

        await AIService.generateCommitMessage('/repo', diff, '', progress);

        // two meaningful files of ~1k each → two parts, then the message
        expect(generate).toHaveBeenCalledTimes(3);
        const options = generatePrompt.mock.calls[0][4];
        expect(options.summaries.text).toBe('- part\n- part');
        expect(options.summaries.files).toContain('package-lock.json (+150 -0) generated');
        expect(generatePrompt.mock.calls[0][1]).toBe('');
        expect(generate.mock.calls[0][3]).toMatchObject({ maxTokens: 512 });
    });

    it('sends the truncated diff in one call when summaries are off', async () => {
        settings['general.summarizeLargeDiffs'] = false;

        await AIService.generateCommitMessage('/repo', diff, '', progress);

        expect(generate).toHaveBeenCalledTimes(1);
        expect(generatePrompt.mock.calls[0][4].summaries).toBeUndefined();
        expect(generatePrompt.mock.calls[0][1].length).toBeLessThan(1100);
    });
});

describe('AIService several suggestions', () => {
    beforeEach(() => {
        settings['commit.commitFormat'] = 'custom';
    });

    it('requests count messages and drops duplicates and failures', async () => {
        generate
            .mockResolvedValueOnce({ message: 'feat: a', model: 'm' })
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ message: 'feat: a', model: 'm' })
            .mockResolvedValueOnce({ message: 'feat: b', model: 'm' });

        const out = await AIService.generateCommitMessages('/repo', 'diff', '', progress, { count: 4 });

        expect(generate).toHaveBeenCalledTimes(4);
        expect(generatePrompt).toHaveBeenCalledOnce();
        expect(out.map(m => m.message)).toEqual(['feat: a', 'feat: b']);
    });

    it('throws when every request fails', async () => {
        generate.mockRejectedValue(new Error('boom'));
        await expect(AIService.generateCommitMessages('/repo', 'diff', '', progress, { count: 2 })).rejects.toThrow('boom');
    });
});
