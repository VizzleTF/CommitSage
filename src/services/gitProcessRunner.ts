import * as vscode from 'vscode';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { buildGitEnv } from '../utils/gitEnv';

// Resolve git to an absolute path instead of letting `spawn` walk $PATH at
// launch time. Prefer VS Code's own `git.path` setting, then the bundled git
// extension's resolved binary; fall back to a bare `git` only when neither is
// available. Hardens against PATH-ordering hijacks (CWE-426 / Sonar S4036).
let cachedGitPath: string | undefined;
function resolveGitPath(): string {
  if (cachedGitPath !== undefined) {
    return cachedGitPath;
  }
  try {
    const configured = vscode.workspace.getConfiguration('git').get<string | string[]>('path');
    let candidates: string[] = [];
    if (Array.isArray(configured)) {
      candidates = configured;
    } else if (configured) {
      candidates = [configured];
    }
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && path.isAbsolute(candidate)) {
        cachedGitPath = candidate;
        return candidate;
      }
    }
    const gitApi = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI?.(1);
    const apiPath: unknown = gitApi?.git?.path;
    if (typeof apiPath === 'string' && path.isAbsolute(apiPath)) {
      cachedGitPath = apiPath;
      return apiPath;
    }
  } catch {
    // Fall through to a bare lookup — better a working extension than a crash.
  }
  cachedGitPath = 'git';
  return 'git';
}

// Invalidate the resolved-path cache when the user changes `git.path` mid
// session, so the next `git` invocation picks up the new binary without a
// window reload. Guarded so importing this module never throws under a
// minimal `vscode` test stub.
if (typeof vscode.workspace?.onDidChangeConfiguration === 'function') {
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('git.path')) {
      cachedGitPath = undefined;
      Logger.log('git.path changed — invalidating cached git path');
    }
  });
}

// Hard cap on stdout/stderr accumulation per `git` invocation. The diff is
// later truncated to MAX_DIFF_LENGTH (100k) by aiService.ts; this cap is the
// *upstream* guard so a runaway generated file never lets the buffer balloon
// to hundreds of MB before truncation.
const GIT_OUTPUT_BUFFER_CAP = 200_000;

/**
 * Owns the mechanics of running the `git` binary: path resolution, process
 * spawning, output buffering with a hard cap, timeout/abort handling, and
 * exit-code interpretation. Everything in `GitService` runs through here.
 */
export class GitProcessRunner {
  static async execGit(
    args: string[],
    cwd: string,
    options: { signal?: AbortSignal; allowNonZeroExit?: boolean } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timeoutSeconds = ConfigService.get('gitTimeout');
      const timeoutMs =
        timeoutSeconds === -1 ? undefined : timeoutSeconds * 1000;

      const child = spawn(resolveGitPath(), args, {
        cwd,
        env: buildGitEnv(),
        timeout: timeoutMs,
      });
      // Decode stdout/stderr as UTF-8 strings via the stream's StringDecoder so
      // multibyte sequences split across chunk boundaries aren't corrupted.
      child.stdout.setEncoding('utf-8');
      child.stderr.setEncoding('utf-8');

      let stdout = '';
      let stderr = '';
      let aborted = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const onAbort = (): void => {
        aborted = true;
        child.kill('SIGTERM');
        // Hard-kill if still alive after grace period
        killTimer = setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 1500);
        killTimer.unref?.();
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      let bufferOverflowed = false;
      child.stdout.on('data', (data: string) => {
        if (stdout.length >= GIT_OUTPUT_BUFFER_CAP) {
          if (!bufferOverflowed) {
            bufferOverflowed = true;
            child.kill('SIGTERM');
          }
          return;
        }
        stdout += data;
      });

      child.stderr.on('data', (data: string) => {
        if (stderr.length >= GIT_OUTPUT_BUFFER_CAP) {
          return;
        }
        stderr += data;
      });

      child.on('error', (err: Error) => {
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }
        reject(err);
      });

      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        if (killTimer) {
          clearTimeout(killTimer);
        }
        if (aborted) {
          reject(new Error('Git command cancelled'));
          return;
        }
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          if (bufferOverflowed) {
            // Truncate to the cap and proceed; downstream truncation
            // (MAX_DIFF_LENGTH in aiService.ts) handles the rest.
            resolve({
              stdout: stdout.slice(0, GIT_OUTPUT_BUFFER_CAP),
              stderr,
              exitCode: -1,
            });
            return;
          }
          // Likely killed by the spawn `timeout` option
          reject(
            new Error(
              `Git command timed out after ${timeoutSeconds}s: git ${args[0] ?? ''}. Increase commitSage.gitTimeout if this is a slow operation.`,
            ),
          );
          return;
        }
        const exitCode = code ?? -1;
        if (code === 0 || options.allowNonZeroExit) {
          resolve({ stdout, stderr, exitCode });
        } else {
          reject(
            new Error(`Git command failed with code ${code}: ${stderr}`),
          );
        }
      });
    });
  }
}
