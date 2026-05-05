import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const exec = promisify(execFile);

// Repos are created INSIDE the sample workspace folder (a subfolder of the
// open .code-workspace). vscode.git's `git.autoRepositoryDetection: subFolders`
// then picks them up without needing updateWorkspaceFolders, which forces a
// reload when converting single-folder → multi-root.
function sampleWorkspaceDir(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new Error('No workspace folder open — set workspaceFolder in .vscode-test.mjs');
    }
    return folders[0].uri.fsPath;
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, { cwd });
    return stdout;
}

export interface MakeRepoOptions {
    initialCommit?: boolean;
    bareRemote?: boolean;
}

export interface TempRepo {
    path: string;
    remotePath?: string;
}

let counter = 0;

export async function makeTempRepo(opts: MakeRepoOptions = {}): Promise<TempRepo> {
    const base = sampleWorkspaceDir();
    const dir = path.join(base, `repo-${Date.now()}-${counter++}`);
    await fs.mkdir(dir, { recursive: true });
    await git(dir, 'init', '-b', 'main');
    await git(dir, 'config', 'user.email', 'e2e@commitsage.test');
    await git(dir, 'config', 'user.name', 'E2E');
    await git(dir, 'config', 'commit.gpgsign', 'false');

    let remotePath: string | undefined;
    if (opts.initialCommit) {
        await fs.writeFile(path.join(dir, 'README.md'), '# seed\n');
        await git(dir, 'add', 'README.md');
        await git(dir, 'commit', '-m', 'chore: seed');
    }
    if (opts.bareRemote) {
        remotePath = path.join(base, `remote-${Date.now()}-${counter++}.git`);
        await fs.mkdir(remotePath, { recursive: true });
        await git(remotePath, 'init', '--bare', '-b', 'main');
        await git(dir, 'remote', 'add', 'origin', remotePath);
        if (opts.initialCommit) {
            await git(dir, 'push', '-u', 'origin', 'main');
        }
    }
    await ensureRepoOpened(dir);
    return { path: dir, remotePath };
}

async function ensureRepoOpened(dir: string): Promise<void> {
    const api = await getGitApi();
    const realDir = await fs.realpath(dir);
    if (matchRepo(api.repositories, realDir)) return;
    try {
        await api.openRepository(vscode.Uri.file(realDir));
    } catch {
        // openRepository can race with auto-discovery — fall through to wait
    }
    await waitFor(() => Boolean(matchRepo(api.repositories, realDir)), 10_000);
}

async function getGitApi(): Promise<{
    repositories: { rootUri: vscode.Uri }[];
    openRepository: (uri: vscode.Uri) => Promise<unknown>;
}> {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) throw new Error('vscode.git extension not present');
    if (!gitExt.isActive) await gitExt.activate();
    return gitExt.exports.getAPI(1);
}

function matchRepo(
    repos: { rootUri: vscode.Uri }[],
    dir: string,
): { rootUri: vscode.Uri } | undefined {
    return repos.find(r => sameFsPath(r.rootUri.fsPath, dir));
}

export function getRepository(dir: string): {
    rootUri: vscode.Uri;
    inputBox: { value: string };
} {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) throw new Error('vscode.git not present');
    const api = gitExt.exports.getAPI(1);
    let realDir = dir;
    try {
        // best-effort: realpathSync via process is not available here, so we
        // rely on findIndex below picking up either form.
    } catch { /* noop */ }
    const repo = api.repositories.find((r: { rootUri: vscode.Uri }) =>
        sameFsPath(r.rootUri.fsPath, realDir) || sameFsPath(r.rootUri.fsPath, dir),
    );
    if (!repo) throw new Error(`repository not found for ${dir}`);
    return repo;
}

export async function cleanupRepo(repo: TempRepo): Promise<void> {
    // Close repo in vscode.git first so it stops watching the dir, otherwise
    // the next test inherits stale state (`Repository not initialized`).
    await closeAllOpenRepos();
    if (process.env.COMMITSAGE_E2E_KEEP === '1') {
        // eslint-disable-next-line no-console
        console.log(`[keep] repo retained: ${repo.path}${repo.remotePath ? `, remote: ${repo.remotePath}` : ''}`);
        return;
    }
    await fs.rm(repo.path, { recursive: true, force: true });
    if (repo.remotePath) {
        await fs.rm(repo.remotePath, { recursive: true, force: true });
    }
}

export async function closeAllOpenRepos(): Promise<void> {
    const api = await getGitApi();
    for (const r of [...api.repositories]) {
        try {
            await vscode.commands.executeCommand('git.close', r);
        } catch {
            // No-op: missing command on older VS Code, or repo already gone.
        }
    }
}

export async function purgeSampleWorkspace(): Promise<void> {
    const base = sampleWorkspaceDir();
    let entries: string[] = [];
    try {
        entries = await fs.readdir(base);
    } catch { return; }
    for (const e of entries) {
        if (e.startsWith('repo-') || e.startsWith('remote-')) {
            await fs.rm(path.join(base, e), { recursive: true, force: true });
        }
    }
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`waitFor: condition not met in ${timeoutMs}ms`);
}

function sameFsPath(a: string, b: string): boolean {
    return path.normalize(a) === path.normalize(b);
}
