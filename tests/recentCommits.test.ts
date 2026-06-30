import { describe, it, expect, afterEach, vi } from 'vitest';
import { GitService } from '../src/services/gitService';

const REPO = '/repo';
type ExecResult = { stdout: string; stderr: string; exitCode: number };
let spy: ReturnType<typeof vi.spyOn> | undefined;

function mockGit(handler: (args: string[]) => string): void {
    spy = vi.spyOn(
        GitService as unknown as { execGit: (a: string[], c: string, o?: unknown) => Promise<ExecResult> },
        'execGit',
    ).mockImplementation(async (args: string[]) => ({ stdout: handler(args), stderr: '', exitCode: 0 }));
}

afterEach(() => { spy?.mockRestore(); spy = undefined; });

const NUL = '\0';

describe('GitService.getRecentCommitMessages', () => {
    it('filters merges/bumps/short messages and slices to count', async () => {
        mockGit((args) => {
            if (args[0] === 'log') {
                return [
                    'feat(x): add a real feature\n\n- with a body',
                    'Bump version to 1.2.3',          // noise
                    'fix(y): fix a real bug',
                    'wip',                             // too short + wip
                    'refactor(z): restructure module',
                    'Merge branch main',               // noise (also --no-merges, belt+braces)
                    'perf: speed up parsing',
                ].join(NUL);
            }
            return '';
        });

        const msgs = await GitService.getRecentCommitMessages(REPO, 3, 'all');
        expect(msgs).toEqual([
            'feat(x): add a real feature\n\n- with a body',
            'fix(y): fix a real bug',
            'refactor(z): restructure module',
        ]);
    });

    it('over-fetches (count×3) and passes --no-merges', async () => {
        const seen: string[][] = [];
        mockGit((args) => { if (args[0] === 'log') { seen.push(args); return 'feat: a real one here'; } return ''; });
        await GitService.getRecentCommitMessages(REPO, 5, 'all');
        expect(seen[0]).toContain('--no-merges');
        expect(seen[0]).toContain('-n');
        expect(seen[0][seen[0].indexOf('-n') + 1]).toBe('15'); // 5 × 3
    });

    it('scope "mine" resolves user.email and adds an --author filter', async () => {
        const logArgs: string[][] = [];
        mockGit((args) => {
            if (args[0] === 'config' && args[1] === 'user.email') { return 'me@example.com\n'; }
            if (args[0] === 'log') { logArgs.push(args); return 'feat: mine only commit'; }
            return '';
        });
        await GitService.getRecentCommitMessages(REPO, 2, 'mine');
        expect(logArgs[0]).toContain('--author=me@example.com');
    });

    it('returns [] for count <= 0 without calling git', async () => {
        let called = false;
        mockGit(() => { called = true; return ''; });
        expect(await GitService.getRecentCommitMessages(REPO, 0, 'all')).toEqual([]);
        expect(called).toBe(false);
    });

    it('returns [] (never throws) when git fails', async () => {
        spy = vi.spyOn(
            GitService as unknown as { execGit: (a: string[], c: string, o?: unknown) => Promise<ExecResult> },
            'execGit',
        ).mockRejectedValue(new Error('git boom'));
        expect(await GitService.getRecentCommitMessages(REPO, 3, 'all')).toEqual([]);
    });
});
