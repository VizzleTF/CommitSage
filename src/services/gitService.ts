import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { createHash } from "crypto";
import { spawn } from "child_process";
import { Logger } from "../utils/logger";
import {
  GitExtensionNotFoundError,
  NoRepositoriesFoundError,
  NoChangesDetectedError,
  NoRepositorySelectedError,
} from "../models/errors";
import { TelemetryService } from "./telemetryService";
import { toError } from "../utils/errorUtils";

const GIT_STATUS_CODES = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "??",
  submodule: "S",
} as const;

type GitStatusCode = (typeof GIT_STATUS_CODES)[keyof typeof GIT_STATUS_CODES];

const STAGED_STATUS_CODES: GitStatusCode[] = [
  GIT_STATUS_CODES.modified,
  GIT_STATUS_CODES.added,
  GIT_STATUS_CODES.deleted,
  GIT_STATUS_CODES.renamed,
];

/**
 * Unquotes a file path returned by git.
 * Git quotes paths containing spaces or special characters (including Unicode).
 * Unicode characters are escaped as octal sequences (e.g., ⚡ → \342\232\241).
 * This function removes the quotes and unescapes the path.
 */
function unquoteGitPath(filePath: string): string {
  if (!filePath.startsWith('"') || !filePath.endsWith('"')) {
    return filePath;
  }
  // Remove surrounding quotes
  let unquoted = filePath.slice(1, -1);

  // Unescape octal sequences (e.g., \342\232\241 for ⚡)
  // Git uses octal escape sequences for non-ASCII characters
  unquoted = unquoted.replace(/\\([0-7]{3})/g, (_, octal) => {
    return String.fromCharCode(parseInt(octal, 8));
  });

  // Convert the resulting byte sequence to proper UTF-8 string
  // The octal escapes represent UTF-8 bytes, so we need to decode them
  try {
    const bytes = new Uint8Array([...unquoted].map((c) => c.charCodeAt(0)));
    unquoted = new TextDecoder("utf-8").decode(bytes);
  } catch {
    // If decoding fails, keep the string as-is
  }

  // Unescape common escape sequences
  unquoted = unquoted.replace(/\\"/g, '"');
  unquoted = unquoted.replace(/\\\\/g, "\\");
  return unquoted;
}

export class GitService {
  static async initialize(): Promise<void> {
    try {
      Logger.log("Initializing Git service");
      await this.validateGitExtension();
      Logger.log("Git service initialized successfully");
    } catch (error) {
      Logger.error("Failed to initialize Git service:", toError(error));
      throw error;
    }
  }

  static async commitChanges(
    message: string,
    repository?: vscode.SourceControl,
  ): Promise<void> {
    try {
      const repo = repository || (await this.getActiveRepository());
      if (!repo?.rootUri) {
        throw new Error("No active repository found");
      }

      const repoPath = repo.rootUri.fsPath;
      const hasStagedChanges = await this.hasChanges(repoPath, "staged");
      const hasUntrackedFiles = await this.hasChanges(repoPath, "untracked");
      const hasDeletedFiles = await this.hasChanges(repoPath, "deleted");

      if (!hasStagedChanges && !hasUntrackedFiles && !hasDeletedFiles) {
        throw new NoChangesDetectedError();
      }

      if ((hasUntrackedFiles || hasDeletedFiles) && !hasStagedChanges) {
        await this.executeGitCommand(["add", "-A"], repoPath);
      }

      await this.executeGitCommand(["commit", "-m", message], repoPath);
      Logger.log("Changes committed successfully");

      TelemetryService.sendEvent("commit_completed", {
        hasStaged: hasStagedChanges,
        hasUntracked: hasUntrackedFiles,
        hasDeleted: hasDeletedFiles,
        messageLength: message.length,
      });
    } catch (error) {
      TelemetryService.sendEvent("commit_failed", {
        error: (toError(error)).message,
      });
      Logger.error("Failed to commit changes:", toError(error));
      throw error;
    }
  }

  private static async hasRemotes(repoPath: string): Promise<boolean> {
    try {
      const result = await this.executeGitCommand(["remote"], repoPath);
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  static async pushChanges(repository?: vscode.SourceControl): Promise<void> {
    try {
      const repo = repository || (await this.getActiveRepository());
      if (!repo?.rootUri) {
        throw new Error("No active repository found");
      }

      const repoPath = repo.rootUri.fsPath;
      if (!(await this.hasRemotes(repoPath))) {
        throw new Error(
          "Repository has no configured remotes. Please add a remote repository using git remote add <name> <url>",
        );
      }

      await this.executeGitCommand(["push"], repoPath);
    } catch (error) {
      Logger.error("Failed to push changes:", toError(error));
      throw error;
    }
  }

  static async getDiff(
    repoPath: string,
    onlyStagedChanges: boolean,
  ): Promise<string> {
    try {
      const hasHead = await this.hasHead(repoPath);
      const hasStagedChanges = await this.hasChanges(repoPath, "staged");
      const hasUnstagedChanges =
        !onlyStagedChanges && (await this.hasChanges(repoPath, "unstaged"));
      const hasUntrackedFiles =
        !onlyStagedChanges &&
        !hasStagedChanges &&
        (await this.hasChanges(repoPath, "untracked"));
      const hasDeletedFiles =
        hasHead &&
        !onlyStagedChanges &&
        !hasStagedChanges &&
        (await this.hasChanges(repoPath, "deleted"));

      if (
        !hasStagedChanges &&
        !hasUnstagedChanges &&
        !hasUntrackedFiles &&
        !hasDeletedFiles
      ) {
        throw new NoChangesDetectedError();
      }

      const diffs: string[] = [];

      if (onlyStagedChanges && hasStagedChanges) {
        const staged = await this.getStagedDiff(repoPath);
        diffs.push(...staged);
        return diffs.join("\n\n").trim();
      }

      if (hasStagedChanges) {
        const staged = await this.getStagedDiff(repoPath, "# Staged changes:\n");
        diffs.push(...staged);
      }

      if (hasUnstagedChanges) {
        const unstaged = await this.getUnstagedDiff(repoPath);
        diffs.push(...unstaged);
      }

      if (hasUntrackedFiles) {
        const untracked = await this.getUntrackedDiff(repoPath);
        if (untracked) {
          diffs.push(untracked);
        }
      }

      if (hasDeletedFiles) {
        const deleted = await this.getDeletedDiff(repoPath);
        if (deleted) {
          diffs.push(deleted);
        }
      }

      const combinedDiff = diffs.join("\n\n").trim();
      if (!combinedDiff) {
        throw new NoChangesDetectedError();
      }

      return combinedDiff;
    } catch (error) {
      if (error instanceof NoChangesDetectedError) {
        throw error;
      }
      Logger.error("Error getting diff:", toError(error));
      throw new Error(`Failed to get diff: ${(toError(error)).message}`);
    }
  }

  private static async isSubmodule(file: string, repoPath: string): Promise<boolean> {
    try {
      const { stdout } = await this.execGit(
        ["ls-files", "--stage", "--", file],
        repoPath,
      );
      return stdout.includes("160000");
    } catch {
      return false;
    }
  }

  private static async getStagedDiff(repoPath: string, prefix?: string): Promise<string[]> {
    const diffs: string[] = [];
    const stagedFiles = (
      await this.executeGitCommand(
        ["diff", "--cached", "--name-only"],
        repoPath,
      )
    )
      .split("\n")
      .filter((file) => file.trim())
      .map(unquoteGitPath);

    for (const file of stagedFiles) {
      if (!(await this.isSubmodule(file, repoPath))) {
        const fileDiff = await this.executeGitCommand(
          ["diff", "--cached", "--", file],
          repoPath,
        );
        if (fileDiff.trim()) {
          diffs.push(prefix ? prefix + fileDiff : fileDiff);
        }
      }
    }
    return diffs;
  }

  private static async getUnstagedDiff(repoPath: string): Promise<string[]> {
    const diffs: string[] = [];
    const unstagedFiles = (
      await this.executeGitCommand(["diff", "--name-only"], repoPath)
    )
      .split("\n")
      .filter((file) => file.trim())
      .map(unquoteGitPath);

    for (const file of unstagedFiles) {
      if (!(await this.isSubmodule(file, repoPath))) {
        const fileDiff = await this.executeGitCommand(
          ["diff", "--", file],
          repoPath,
        );
        if (fileDiff.trim()) {
          diffs.push("# Unstaged changes:\n" + fileDiff);
        }
      }
    }
    return diffs;
  }

  private static async getUntrackedDiff(repoPath: string): Promise<string> {
    const untrackedFiles = await this.executeGitCommand(
      ["ls-files", "--others", "--exclude-standard"],
      repoPath,
    );
    const untrackedDiff = await Promise.all(
      untrackedFiles
        .split("\n")
        .filter((file) => file.trim())
        .map(unquoteGitPath)
        .map(async (file) => {
          try {
            const content = await fs.promises.readFile(
              path.join(repoPath, file),
              "utf-8",
            );

            if (content.includes("\0")) {
              return `diff --git a/${file} b/${file}\nnew file mode 100644\nBinary file ${file}`;
            }

            const lines = content.split("\n");
            const contentDiff = lines
              .map((line: string) => `+${line}`)
              .join("\n");
            return `diff --git a/${file} b/${file}\nnew file mode 100644\nindex 0000000..${this.calculateFileHash(content)}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${contentDiff}`;
          } catch (error) {
            Logger.error(
              `Error reading new file ${file}:`,
              toError(error),
            );
            return "";
          }
        }),
    );
    const validDiffs = untrackedDiff.filter((diff) => diff.trim());
    return validDiffs.length > 0 ? "# New files:\n" + validDiffs.join("\n") : "";
  }

  private static async getDeletedDiff(repoPath: string): Promise<string> {
    const deletedFiles = await this.executeGitCommand(
      ["ls-files", "--deleted"],
      repoPath,
    );
    const deletedDiff = await Promise.all(
      deletedFiles
        .split("\n")
        .filter((file) => file.trim())
        .map(unquoteGitPath)
        .map(async (file) => {
          try {
            const oldContent = await this.executeGitCommand(
              ["show", `HEAD:${file}`],
              repoPath,
            );
            return `diff --git a/${file} b/${file}\ndeleted file mode 100644\n--- a/${file}\n+++ /dev/null\n@@ -1 +0,0 @@\n-${oldContent.trim()}\n`;
          } catch {
            return "";
          }
        }),
    );
    const validDiffs = deletedDiff.filter((diff) => diff.trim());
    return validDiffs.length > 0 ? "# Deleted files:\n" + validDiffs.join("\n") : "";
  }

  public static async hasHead(repoPath: string): Promise<boolean> {
    try {
      await this.execGit(["rev-parse", "HEAD"], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  static async hasChanges(
    repoPath: string,
    type: "staged" | "unstaged" | "untracked" | "deleted",
  ): Promise<boolean> {
    try {
      let command: string[];
      switch (type) {
        case "staged":
          command = ["diff", "--cached", "--name-only"];
          break;
        case "unstaged":
          command = ["diff", "--name-only"];
          break;
        case "untracked":
          command = ["ls-files", "--others", "--exclude-standard"];
          break;
        case "deleted":
          command = ["ls-files", "--deleted"];
          break;
        default:
          throw new Error(`Invalid change type: ${type}`);
      }

      const output = await this.executeGitCommand(command, repoPath);
      return output.trim().length > 0;
    } catch (error) {
      Logger.error(`Error checking for ${type} changes:`, toError(error));
      return false;
    }
  }

  static async getChangedFiles(
    repoPath: string,
    onlyStaged: boolean = false,
  ): Promise<string[]> {
    try {
      const statusCommand = ["status", "--porcelain"];
      const output = await this.executeGitCommand(statusCommand, repoPath);

      return output
        .split("\n")
        .filter((line) => line.trim() !== "")
        .filter((line) => {
          if (line.includes("Subproject commit") || line.includes("Entering")) {
            return false;
          }

          if (onlyStaged) {
            // For staged changes, check first character
            return STAGED_STATUS_CODES.includes(line[0] as GitStatusCode);
          }
          // For all changes, check both staged and unstaged status
          const [staged, unstaged] = [line[0], line[1]];
          return staged !== " " || unstaged !== " ";
        })
        .map((line) => {
          const status = line.substring(0, 2);
          let filePath = line.substring(3).trim();

          // Handle renamed files (they have format "R100 old-name -> new-name")
          if (status.startsWith("R")) {
            filePath = filePath.split(" -> ")[1];
          }

          // Unquote paths that git quoted due to spaces or special characters
          filePath = unquoteGitPath(filePath);

          // Log file status for debugging
          Logger.log(`File ${filePath} has status: ${status}`);

          // Return relative path as git status returns it
          return filePath;
        });
    } catch (error) {
      Logger.error("Error getting changed files:", toError(error));
      return [];
    }
  }

  private static async executeGitCommand(
    args: string[],
    cwd: string,
  ): Promise<string> {
    const { stdout, stderr } = await this.execGit(args, cwd);
    if (stderr) {
      throw new Error(stderr);
    }
    return stdout;
  }

  static async getRepositories(): Promise<vscode.SourceControl[]> {
    try {
      const extension =
        vscode.extensions.getExtension<GitExtension>("vscode.git");
      if (!extension) {
        throw new GitExtensionNotFoundError();
      }

      const gitExtension = await extension.activate();
      const git = gitExtension.getAPI(1);

      if (!git?.repositories?.length) {
        throw new NoRepositoriesFoundError();
      }

      return git.repositories;
    } catch {
      throw new GitExtensionNotFoundError();
    }
  }

  static async selectRepository(
    repos: vscode.SourceControl[],
  ): Promise<vscode.SourceControl> {
    const repoOptions = repos.map((repo) => ({
      label: repo.rootUri
        ? path.basename(repo.rootUri.fsPath)
        : "Unknown repository",
      description: repo.rootUri ? repo.rootUri.fsPath : undefined,
      repository: repo,
    }));

    const selected = await vscode.window.showQuickPick(repoOptions, {
      placeHolder: "Select the repository to generate commit message",
    });

    if (!selected) {
      throw new NoRepositorySelectedError();
    }
    return selected.repository;
  }

  static async getActiveRepository(
    sourceControlRepository?: vscode.SourceControl,
  ): Promise<vscode.SourceControl> {
    if (sourceControlRepository?.rootUri) {
      return sourceControlRepository;
    }

    const repos = await this.getRepositories();
    if (repos.length === 1) {
      return repos[0];
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const activeFile = activeEditor.document.uri;
      const activeRepo = repos.find((repo) => {
        if (!repo.rootUri) {
          return false;
        }
        return activeFile.fsPath.startsWith(repo.rootUri.fsPath);
      });
      if (activeRepo) {
        return activeRepo;
      }
    }

    return this.selectRepository(repos);
  }

  static async validateGitExtension(): Promise<void> {
    const extension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) {
      throw new GitExtensionNotFoundError();
    }
    await extension.activate();
  }

  public static async execGit(
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const process = spawn("git", args, { cwd });
      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      process.on("close", (code: number) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Git command failed with code ${code}: ${stderr}`));
        }
      });
    });
  }

  public static async isNewFile(
    filePath: string,
    repoPath: string,
  ): Promise<boolean> {
    const normalizedPath = path.normalize(filePath.replace(/^\/+/, ""));
    const { stdout } = await this.execGit(
      ["status", "--porcelain", "--", normalizedPath],
      repoPath,
    );
    const status = stdout.slice(0, 2);
    return status === "??" || status === "A ";
  }

  public static async isFileDeleted(
    filePath: string,
    repoPath: string,
  ): Promise<boolean> {
    const normalizedPath = path.normalize(filePath.replace(/^\/+/, ""));
    const { stdout } = await this.execGit(
      ["status", "--porcelain", "--", normalizedPath],
      repoPath,
    );
    const status = stdout.slice(0, 2);
    return status === " D" || status === "D ";
  }

  private static calculateFileHash(content: string): string {
    const buffer = Buffer.from(content);
    const header = `blob ${buffer.byteLength}\0`;
    return createHash("sha1")
      .update(header)
      .update(buffer)
      .digest("hex")
      .substring(0, 7);
  }
}

interface GitExtension {
  getAPI(version: 1): {
    repositories: vscode.SourceControl[];
  };
}
