import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockGetTemplate, mockExtractRules, mockGetCustomTemplate } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockGetTemplate: vi.fn(),
    mockExtractRules: vi.fn(),
    mockGetCustomTemplate: vi.fn(),
}));

vi.mock('../src/templates', () => ({
    getTemplate: mockGetTemplate,
    CommitFormat: {},
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: { get: mockGet },
}));

vi.mock('../src/services/commitLintService', () => ({
    CommitLintService: { extractRules: mockExtractRules },
    CommitLintEngine: {},
}));

vi.mock('../src/services/customLanguageService', () => ({
    CustomLanguageService: { getTemplate: mockGetCustomTemplate },
}));

import { PromptService } from '../src/services/promptService';

const progress = { report: vi.fn() };

beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplate.mockImplementation((_f: string, lang: string) => `TEMPLATE[${lang}]`);
    mockExtractRules.mockResolvedValue('RULES');
    mockGetCustomTemplate.mockResolvedValue('CUSTOM_TEMPLATE');
    mockGet.mockReturnValue(undefined);
});

const cfg = (map: Record<string, unknown>) =>
    mockGet.mockImplementation((k: string) => (k in map ? map[k] : undefined));

describe('generatePrompt — custom instructions branch', () => {
    it('uses custom instructions verbatim when enabled and non-empty', async () => {
        cfg({ 'commit.useCustomInstructions': true, 'commit.customInstructions': 'MY RULES' });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out).toContain('MY RULES');
        expect(out).toContain('DIFF');
        expect(out).toContain('BLAME');
        expect(out).toContain('STRICT OUTPUT RULES');
        expect(mockGetTemplate).not.toHaveBeenCalled();
    });

    it('falls through when custom instructions are blank', async () => {
        cfg({
            'commit.useCustomInstructions': true,
            'commit.customInstructions': '   ',
            'commit.commitFormat': 'conventional',
            'commit.commitLanguage': 'english',
        });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out).toContain('TEMPLATE[english]');
    });
});

describe('generatePrompt — language resolution', () => {
    it('uses the known-language prompt for a non-custom language', async () => {
        cfg({ 'commit.commitFormat': 'conventional', 'commit.commitLanguage': 'russian' });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out).toContain('TEMPLATE[russian]');
        expect(out).toContain('на русском');
    });

    it('falls back to English prompt for an unmapped language', async () => {
        cfg({ 'commit.commitFormat': 'conventional', 'commit.commitLanguage': 'elvish' });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out).toContain('Please write the commit message in English.');
    });

    it('uses the custom-language service and a named language prompt', async () => {
        cfg({
            'commit.commitFormat': 'conventional',
            'commit.commitLanguage': 'custom',
            'commit.customLanguageName': 'Klingon',
        });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out).toContain('CUSTOM_TEMPLATE');
        expect(out).toContain('Please write the commit message in Klingon.');
    });

    it('uses the English prompt when the custom language name is blank', async () => {
        cfg({
            'commit.commitFormat': 'conventional',
            'commit.commitLanguage': 'custom',
            'commit.customLanguageName': '  ',
        });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out).toContain('CUSTOM_TEMPLATE');
        expect(out).toContain('Please write the commit message in English.');
    });
});

describe('generatePrompt — reminder + commitlint', () => {
    it('uses the detailed reminder for the detailed format', async () => {
        cfg({ 'commit.commitFormat': 'detailed', 'commit.commitLanguage': 'english' });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out).toContain('Follow the Summary/Details/Effects template exactly.');
    });

    it('appends commitlint rules when enabled and format is not custom', async () => {
        cfg({
            'commit.commitFormat': 'conventional',
            'commit.commitLanguage': 'english',
            'commit.commitlint.enabled': true,
            'commit.commitlint.rulesPath': '/rules',
            'commit.commitlint.engine': 'cli',
        });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out).toContain('RULES');
        expect(mockExtractRules).toHaveBeenCalledWith('/repo', '/rules', { engine: 'cli', format: 'conventional' });
    });

    it('does not append rules when commitlint enabled but format is custom', async () => {
        cfg({
            'commit.commitFormat': 'custom',
            'commit.commitLanguage': 'english',
            'commit.commitlint.enabled': true,
        });
        await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(mockExtractRules).not.toHaveBeenCalled();
    });
});

describe('generateRefinementPrompt', () => {
    it('builds a refinement prompt with errors and rules', async () => {
        cfg({
            'commit.commitFormat': 'conventional',
            'commit.commitLanguage': 'english',
            'commit.commitlint.rulesPath': '/rules',
            'commit.commitlint.engine': 'cli',
        });
        const out = await PromptService.generateRefinementPrompt('/repo', 'orig msg', ['err1', 'err2'], progress as never);
        expect(out).toContain('orig msg');
        expect(out).toContain('- err1');
        expect(out).toContain('- err2');
        expect(out).toContain('RULES');
        expect(mockExtractRules).toHaveBeenCalledWith('/repo', '/rules', { engine: 'cli', format: 'conventional' });
    });

    it('maps the custom format to conventional for template resolution', async () => {
        cfg({
            'commit.commitFormat': 'custom',
            'commit.commitLanguage': 'english',
        });
        await PromptService.generateRefinementPrompt('/repo', 'orig', ['e'], progress as never);
        // template fetched for 'conventional', not 'custom'
        expect(mockGetTemplate).toHaveBeenCalledWith('conventional', 'english');
        // but extractRules still gets the raw setting ('custom')
        expect(mockExtractRules).toHaveBeenCalledWith('/repo', undefined, expect.objectContaining({ format: 'custom' }));
    });
});
