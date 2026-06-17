import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { Logger } from '../utils/logger';

import { CommitLintResult, CommitLintRules } from '../models/types';

// Generous: on Windows-mounted filesystems (WSL /mnt/*) a single CLI run can
// take 5-10s because cosmiconfig's config search is I/O bound there.
const RUN_TIMEOUT_MS = 30_000;

interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs the project's own commitlint CLI (from the repo's node_modules) in a
 * child process. This gives full fidelity with whatever the project's CI does:
 * shareable presets, extends chains, plugins, parserPreset — any commitlint
 * version, ESM or CJS, since it executes in its own Node process.
 *
 * Every method returns null when the project engine can't be used, so callers
 * can fall back to the builtin static engine.
 */
class CommitLintCliService {
  /**
   * Walks up from repoPath looking for an installed commitlint CLI
   * (`commitlint` or `@commitlint/cli`). Manual node_modules walk instead of
   * require.resolve: not blocked by package `exports` maps and works the same
   * for ESM-only versions (v19+).
   */
  static detect(repoPath: string): string | null {
    let dir = repoPath;
    for (;;) {
      for (const name of ['commitlint', '@commitlint/cli']) {
        const pkgJsonPath = path.join(dir, 'node_modules', name, 'package.json');
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
            bin?: string | Record<string, string>;
          };
          const bin = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.['commitlint'];
          if (bin) {
            const cliPath = path.join(path.dirname(pkgJsonPath), bin);
            if (fs.existsSync(cliPath)) { return cliPath; }
          }
        } catch {
          // missing or unreadable — try the next name / parent dir
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) { return null; }
      dir = parent;
    }
  }

  /**
   * Validates via the project CLI. The message goes to stdin; validity is the
   * exit code. Returns null (→ builtin fallback) when the CLI is missing,
   * crashes, times out, or has no usable config.
   */
  static async validate(
    message: string,
    repoPath: string,
    rulesPath?: string,
    signal?: AbortSignal,
  ): Promise<CommitLintResult | null> {
    const cliPath = this.detect(repoPath);
    if (!cliPath) { return null; }

    const args = ['--color', 'false', ...this.configArgs(repoPath, rulesPath)];
    const res = await this.run(cliPath, args, message, repoPath, signal);

    if (res.timedOut || res.exitCode === null) {
      Logger.warn(`CommitLint: project CLI ${res.timedOut ? 'timed out' : 'failed to run'} — falling back to builtin validator`);
      return null;
    }
    if (res.exitCode === 0) { return { valid: true, errors: [] }; }

    const output = `${res.stdout}\n${res.stderr}`;
    // exit 9 = --config path missing; "Please add rules" = no config resolved.
    if (res.exitCode === 9 || /please add rules/i.test(output)) { return null; }

    // Default formatter lines: "✖   subject may not be empty [subject-empty]".
    // The summary line ("✖   found 2 problems, 0 warnings") is dropped.
    const errors = output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('✖') && !/found \d+ problems/i.test(line))
      .map(line => line.replace(/^✖\s*/, ''));

    return { valid: false, errors: errors.length > 0 ? errors : [output.trim()] };
  }

  /**
   * Fully resolved rules (presets, extends chains and plugins applied) via
   * `--print-config`. Null when unsupported (pre-v19 prints non-JSON) — the
   * caller then extracts rules statically.
   */
  static async resolvedRules(
    repoPath: string,
    rulesPath?: string,
    signal?: AbortSignal,
  ): Promise<CommitLintRules | null> {
    const cliPath = this.detect(repoPath);
    if (!cliPath) { return null; }

    const args = ['--print-config=json', '--color', 'false', ...this.configArgs(repoPath, rulesPath)];
    const res = await this.run(cliPath, args, undefined, repoPath, signal);
    if (res.timedOut || res.exitCode !== 0) { return null; }

    try {
      const config = JSON.parse(res.stdout) as { rules?: CommitLintRules };
      return config.rules && Object.keys(config.rules).length > 0 ? config.rules : null;
    } catch {
      return null;
    }
  }

  private static configArgs(repoPath: string, rulesPath?: string): string[] {
    if (rulesPath && rulesPath !== '.') {
      const abs = path.isAbsolute(rulesPath) ? rulesPath : path.join(repoPath, rulesPath);
      return ['--config', abs];
    }
    return [];
  }

  private static run(
    cliPath: string,
    args: string[],
    stdin: string | undefined,
    repoPath: string,
    signal?: AbortSignal,
  ): Promise<CliRunResult> {
    return new Promise(resolve => {
      // process.execPath is the Electron binary inside the extension host;
      // ELECTRON_RUN_AS_NODE turns it into a plain Node — no system Node needed.
      /* eslint-disable @typescript-eslint/naming-convention */
      const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' };
      /* eslint-enable @typescript-eslint/naming-convention */
      delete env.NODE_OPTIONS;

      const child = spawn(process.execPath, [cliPath, ...args], { cwd: repoPath, env });

      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;

      const finish = (exitCode: number | null): void => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, RUN_TIMEOUT_MS);

      signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });

      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('error', () => finish(null));
      child.on('close', code => finish(code));

      child.stdin.on('error', () => { /* EPIPE when the child exits early */ });
      if (stdin !== undefined) { child.stdin.write(stdin); }
      child.stdin.end();
    });
  }
}

export { CommitLintCliService };
