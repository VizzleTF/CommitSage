import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { mockGetProjectRootPath, mockGetProvider, mockGenerate, mockGetTemplate } = vi.hoisted(() => ({
    mockGetProjectRootPath: vi.fn(),
    mockGetProvider: vi.fn(),
    mockGenerate: vi.fn(),
    mockGetTemplate: vi.fn(),
}));

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        getProjectRootPath: mockGetProjectRootPath,
        getProvider: mockGetProvider,
    },
}));

vi.mock('../src/utils/logger', () => ({
    Logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../src/templates', () => ({
    getTemplate: mockGetTemplate,
    CommitFormat: {},
}));

vi.mock('../src/services/aiServiceFactory', () => ({
    AIServiceFactory: { generateCommitMessage: mockGenerate },
    AIServiceType: {},
}));

import { CustomLanguageService } from '../src/services/customLanguageService';
import { Logger } from '../src/utils/logger';

const progress = { report: vi.fn() };

let tmpDir: string;

beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cls-'));
    mockGetProjectRootPath.mockReturnValue(tmpDir);
    mockGetProvider.mockReturnValue('gemini');
    mockGetTemplate.mockImplementation((_f: string, lang: string) => `template-${lang}`);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const transFile = () => path.join(tmpDir, '.commitsage', 'translations.json');

describe('getCachedTemplate', () => {
    it('returns the cached template when present', async () => {
        fs.mkdirSync(path.join(tmpDir, '.commitsage'));
        fs.writeFileSync(transFile(), JSON.stringify({ Klingon: { conventional: 'cached!' } }));
        const result = await CustomLanguageService.getCachedTemplate('conventional' as never, 'Klingon');
        expect(result).toBe('cached!');
    });

    it('returns null when no translation exists for that language/format', async () => {
        const result = await CustomLanguageService.getCachedTemplate('conventional' as never, 'Klingon');
        expect(result).toBeNull();
    });

    it('returns null (empty translations) when project root is missing', async () => {
        mockGetProjectRootPath.mockReturnValue(undefined);
        const result = await CustomLanguageService.getCachedTemplate('conventional' as never, 'Klingon');
        expect(result).toBeNull();
    });

    it('returns null on malformed JSON (logs error, not ENOENT)', async () => {
        fs.mkdirSync(path.join(tmpDir, '.commitsage'));
        fs.writeFileSync(transFile(), '{ broken');
        const result = await CustomLanguageService.getCachedTemplate('conventional' as never, 'Klingon');
        expect(result).toBeNull();
        expect(Logger.error).toHaveBeenCalled();
    });
});

describe('generateAndCacheTemplate', () => {
    it('translates, trims, caches, and returns the result', async () => {
        mockGenerate.mockResolvedValue({ message: '  translated  ', model: 'm' });
        const result = await CustomLanguageService.generateAndCacheTemplate(
            'conventional' as never, 'Klingon', progress as never,
        );
        expect(result).toBe('translated');
        expect(progress.report).toHaveBeenCalled();
        // file written
        const saved = JSON.parse(fs.readFileSync(transFile(), 'utf8'));
        expect(saved.Klingon.conventional).toBe('translated');
    });

    it('merges into an existing translations file', async () => {
        fs.mkdirSync(path.join(tmpDir, '.commitsage'));
        fs.writeFileSync(transFile(), JSON.stringify({ Other: { angular: 'x' } }));
        mockGenerate.mockResolvedValue({ message: 'klingon-text', model: 'm' });
        await CustomLanguageService.generateAndCacheTemplate('conventional' as never, 'Klingon', progress as never);
        const saved = JSON.parse(fs.readFileSync(transFile(), 'utf8'));
        expect(saved.Other.angular).toBe('x');
        expect(saved.Klingon.conventional).toBe('klingon-text');
    });

    it('adds a new format under an already-present language entry', async () => {
        fs.mkdirSync(path.join(tmpDir, '.commitsage'));
        fs.writeFileSync(transFile(), JSON.stringify({ Klingon: { angular: 'existing' } }));
        mockGenerate.mockResolvedValue({ message: 'conv-text', model: 'm' });
        await CustomLanguageService.generateAndCacheTemplate('conventional' as never, 'Klingon', progress as never);
        const saved = JSON.parse(fs.readFileSync(transFile(), 'utf8'));
        expect(saved.Klingon.angular).toBe('existing');
        expect(saved.Klingon.conventional).toBe('conv-text');
    });

    it('does not throw when project root is missing (save is a no-op)', async () => {
        mockGenerate.mockResolvedValue({ message: 'translated', model: 'm' });
        // root present for generate, absent for save path branch
        mockGetProjectRootPath.mockReturnValue(undefined);
        const result = await CustomLanguageService.generateAndCacheTemplate('conventional' as never, 'Klingon', progress as never);
        expect(result).toBe('translated');
    });

    it('logs an error and swallows write failures', async () => {
        mockGenerate.mockResolvedValue({ message: 'translated', model: 'm' });
        // make .commitsage a FILE so writeFile to a path under it fails after mkdir
        const spy = vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('disk full'));
        const result = await CustomLanguageService.generateAndCacheTemplate('conventional' as never, 'Klingon', progress as never);
        expect(result).toBe('translated');
        expect(Logger.error).toHaveBeenCalledWith('Failed to save translation:', expect.any(Error));
        spy.mockRestore();
    });

    it('logs the save error once when mkdir fails and skips the write', async () => {
        mockGenerate.mockResolvedValue({ message: 'translated', model: 'm' });
        const spy = vi.spyOn(fs.promises, 'mkdir').mockRejectedValue(new Error('no perms'));
        const writeSpy = vi.spyOn(fs.promises, 'writeFile');
        await CustomLanguageService.generateAndCacheTemplate('conventional' as never, 'Klingon', progress as never);
        expect(Logger.error).toHaveBeenCalledTimes(1);
        expect(Logger.error).toHaveBeenCalledWith('Failed to save translation:', expect.any(Error));
        expect(writeSpy).not.toHaveBeenCalled();
        spy.mockRestore();
        writeSpy.mockRestore();
    });
});

describe('getTemplate', () => {
    it('returns the English fallback for an empty/whitespace language name', async () => {
        const result = await CustomLanguageService.getTemplate('conventional' as never, '   ', progress as never);
        expect(result).toBe('template-english');
        expect(Logger.warn).toHaveBeenCalled();
    });

    it('returns the cached template when one exists', async () => {
        fs.mkdirSync(path.join(tmpDir, '.commitsage'));
        fs.writeFileSync(transFile(), JSON.stringify({ Klingon: { conventional: 'cached-v' } }));
        const result = await CustomLanguageService.getTemplate('conventional' as never, 'Klingon', progress as never);
        expect(result).toBe('cached-v');
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('generates a new template when no cache exists', async () => {
        mockGenerate.mockResolvedValue({ message: 'fresh', model: 'm' });
        const result = await CustomLanguageService.getTemplate('conventional' as never, 'Klingon', progress as never);
        expect(result).toBe('fresh');
        expect(mockGenerate).toHaveBeenCalled();
    });
});
