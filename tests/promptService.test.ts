import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockGetTemplate, mockExtractRules, mockGetCustomTemplate, mockRecent } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockGetTemplate: vi.fn(),
    mockExtractRules: vi.fn(),
    mockGetCustomTemplate: vi.fn(),
    mockRecent: vi.fn(),
}));

vi.mock('../src/templates', () => ({
    getTemplate: mockGetTemplate,
    CommitFormat: {},
}));

vi.mock('../src/services/gitService', () => ({
    GitService: { getRecentCommitMessages: mockRecent },
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
    mockRecent.mockResolvedValue([]);
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

    it('appends the rules passed by the caller to the template', async () => {
        cfg({ 'commit.commitFormat': 'conventional', 'commit.commitLanguage': 'english' });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never, 'RULES');
        expect(out).toContain('TEMPLATE[english]\n\nRULES');
        expect(mockExtractRules).not.toHaveBeenCalled();
    });

    it('uses the conventional template for the custom format without instructions', async () => {
        cfg({ 'commit.commitFormat': 'custom', 'commit.commitLanguage': 'english' });
        await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(mockGetTemplate).toHaveBeenCalledWith('conventional', 'english');
    });

    it('leaves the language line out of a custom-instructions prompt', async () => {
        cfg({ 'commit.useCustomInstructions': true, 'commit.customInstructions': 'MY RULES', 'commit.commitLanguage': 'russian' });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(out.startsWith('MY RULES\n\nGit diff to analyze:\nDIFF')).toBe(true);
        expect(out).not.toContain('на русском');
    });
});

describe('loadRules', () => {
    it('extracts the rules with the configured engine, the format and the abort signal', async () => {
        cfg({ 'commit.commitlint.rulesPath': '/rules', 'commit.commitlint.engine': 'project' });
        const signal = new AbortController().signal;
        expect(await PromptService.loadRules('/repo', 'angular', signal)).toBe('RULES');
        expect(mockExtractRules).toHaveBeenCalledWith('/repo', '/rules', { engine: 'project', format: 'angular', signal });
    });
});

describe('generateRefinementPrompt', () => {
    it('builds a refinement prompt from the message, errors and the given rules', () => {
        cfg({ 'commit.commitFormat': 'conventional', 'commit.commitLanguage': 'english' });
        const out = PromptService.generateRefinementPrompt('orig msg', ['err1', 'err2'], 'RULES');
        expect(out).toContain('orig msg');
        expect(out).toContain('- err1');
        expect(out).toContain('- err2');
        expect(out).toContain('RULES');
        expect(out).toContain('Please write the commit message in English.');
        // No template, translation or rule extraction on a retry.
        expect(mockGetTemplate).not.toHaveBeenCalled();
        expect(mockGetCustomTemplate).not.toHaveBeenCalled();
        expect(mockExtractRules).not.toHaveBeenCalled();
    });

    it('names a custom language without translating the template', () => {
        cfg({ 'commit.commitLanguage': 'custom', 'commit.customLanguageName': 'Klingon' });
        const out = PromptService.generateRefinementPrompt('orig', ['e'], 'RULES');
        expect(out).toContain('Please write the commit message in Klingon.');
        expect(mockGetCustomTemplate).not.toHaveBeenCalled();
    });
});

describe('generatePrompt — recent-commit style examples', () => {
    it('injects examples (format-leads framing) when useRecentCommitsAsContext is on', async () => {
        cfg({
            'commit.commitFormat': 'conventional',
            'commit.commitLanguage': 'english',
            'commit.useRecentCommitsAsContext': true,
            'commit.recentCommitsCount': 5,
            'commit.recentCommitsScope': 'all',
        });
        mockRecent.mockResolvedValue(['feat: alpha', 'fix: beta']);

        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);

        expect(mockRecent).toHaveBeenCalledWith('/repo', 5, 'all');
        expect(out).toContain('feat: alpha');
        expect(out).toContain('fix: beta');
        expect(out).toContain('STYLE reference only'); // format leads
        expect(mockGetTemplate).toHaveBeenCalledWith('conventional', 'english');
    });

    it('does not fetch examples when the feature is off and format is not previous', async () => {
        cfg({ 'commit.commitFormat': 'conventional', 'commit.commitLanguage': 'english' });
        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);
        expect(mockRecent).not.toHaveBeenCalled();
        expect(out).not.toContain('STYLE reference only');
    });

    it('previous format: examples LEAD (no "reference only" caveat) and use the previous template', async () => {
        cfg({
            'commit.commitFormat': 'previous',
            'commit.commitLanguage': 'english',
            'commit.recentCommitsCount': 3,
            'commit.recentCommitsScope': 'mine',
        });
        mockRecent.mockResolvedValue(['feat: alpha', 'fix: beta']);

        const out = await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);

        expect(mockRecent).toHaveBeenCalledWith('/repo', 3, 'mine');
        expect(mockGetTemplate).toHaveBeenCalledWith('previous', 'english');
        expect(out).toContain('match their style');
        expect(out).not.toContain('STYLE reference only');
    });

    it('previous format with no history falls back to the conventional template', async () => {
        cfg({ 'commit.commitFormat': 'previous', 'commit.commitLanguage': 'english', 'commit.recentCommitsCount': 5, 'commit.recentCommitsScope': 'all' });
        mockRecent.mockResolvedValue([]);

        await PromptService.generatePrompt('/repo', 'DIFF', 'BLAME', progress as never);

        expect(mockGetTemplate).toHaveBeenCalledWith('conventional', 'english');
    });
});
