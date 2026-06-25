import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockAccess, mockExecGit, mockHasHead, mockIsDeleted, mockIsNew,
    mockParseBlame, mockParseChanged, mockAnalyzeBlame, mockFormat,
    mockError, mockLog,
} = vi.hoisted(() => ({
    mockAccess: vi.fn(),
    mockExecGit: vi.fn(),
    mockHasHead: vi.fn(),
    mockIsDeleted: vi.fn(),
    mockIsNew: vi.fn(),
    mockParseBlame: vi.fn(),
    mockParseChanged: vi.fn(),
    mockAnalyzeBlame: vi.fn(),
    mockFormat: vi.fn(),
    mockError: vi.fn(),
    mockLog: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ access: mockAccess }));

vi.mock('../src/services/gitService', () => ({
    GitService: { execGit: mockExecGit, hasHead: mockHasHead },
    isDeletedStatus: mockIsDeleted,
    isNewStatus: mockIsNew,
}));

vi.mock('../src/services/gitBlameParser', () => ({
    parseBlameOutput: mockParseBlame,
    parseChangedLines: mockParseChanged,
    analyzeBlameInfo: mockAnalyzeBlame,
    formatAnalysis: mockFormat,
}));

vi.mock('../src/utils/logger', () => ({
    Logger: { error: mockError, log: mockLog },
}));

import { GitBlameAnalyzer } from '../src/services/gitBlameAnalyzer';

beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeleted.mockReturnValue(false);
    mockIsNew.mockReturnValue(false);
    mockHasHead.mockResolvedValue(true);
    mockExecGit.mockResolvedValue({ stdout: 'OUT' });
    mockParseBlame.mockReturnValue('BLAME');
    mockParseChanged.mockReturnValue([1, 2]);
    mockAnalyzeBlame.mockReturnValue({ alice: 2 });
    mockFormat.mockReturnValue('FORMATTED');
    mockAccess.mockResolvedValue(undefined);
});

describe('GitBlameAnalyzer.analyzeChanges', () => {
    it('returns a deleted-file marker without running blame', async () => {
        mockIsDeleted.mockReturnValue(true);
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', '/foo/bar.ts', 'D');
        expect(out).toBe('Deleted file: foo/bar.ts');
        expect(mockExecGit).not.toHaveBeenCalled();
    });

    it('returns a new-file marker without running blame', async () => {
        mockIsNew.mockReturnValue(true);
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', 'new.ts', 'A');
        expect(out).toBe('New file: new.ts');
        expect(mockExecGit).not.toHaveBeenCalled();
    });

    it('runs full blame analysis for a modified file', async () => {
        const out = await GitBlameAnalyzer.analyzeChanges('/repo', 'src/a.ts', 'M');
        expect(out).toBe('FORMATTED');
        expect(mockExecGit).toHaveBeenCalledWith(
            ['blame', '--line-porcelain', '--', 'src/a.ts'], '/repo', { signal: undefined },
        );
        expect(mockExecGit).toHaveBeenCalledWith(
            ['diff', '--unified=0', '--', 'src/a.ts'], '/repo', { signal: undefined },
        );
        expect(mockAnalyzeBlame).toHaveBeenCalledWith('BLAME', [1, 2]);
    });

    it('throws fileNotFound when the file is missing', async () => {
        mockAccess.mockRejectedValue(new Error('ENOENT'));
        await expect(GitBlameAnalyzer.analyzeChanges('/repo', 'gone.ts', 'M'))
            .rejects.toThrow(/File not found/);
        expect(mockError).toHaveBeenCalled();
    });

    it('throws noCommitsYet when the repo has no HEAD', async () => {
        mockHasHead.mockResolvedValue(false);
        await expect(GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', 'M'))
            .rejects.toThrow(/no commits yet/i);
    });

    it('logs and rethrows when execGit fails', async () => {
        mockExecGit.mockRejectedValue(new Error('git boom'));
        await expect(GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', 'M'))
            .rejects.toThrow('git boom');
        expect(mockError).toHaveBeenCalledWith('Error analyzing changes:', expect.any(Error));
    });

    it('passes a provided AbortSignal through', async () => {
        const signal = new AbortController().signal;
        await GitBlameAnalyzer.analyzeChanges('/repo', 'a.ts', 'M', signal);
        expect(mockHasHead).toHaveBeenCalledWith('/repo', signal);
        expect(mockExecGit).toHaveBeenCalledWith(expect.anything(), '/repo', { signal });
    });
});
