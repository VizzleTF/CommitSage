import * as path from "path";
import * as fs from "fs";
import { Logger } from "../utils/logger";
import { errorMessages } from "../utils/constants";
import { GitService } from "./gitService";
import { toError } from "../utils/errorUtils";
import {
  BlameInfo,
  analyzeBlameInfo,
  formatAnalysis,
  parseBlameOutput,
  parseChangedLines,
} from "./gitBlameParser";

export class GitBlameAnalyzer {
  private static async getGitBlame(
    filePath: string,
    repoPath: string,
  ): Promise<BlameInfo[]> {
    try {
      const absoluteFilePath = path.resolve(repoPath, filePath);

      if (!fs.existsSync(absoluteFilePath)) {
        throw new Error(`${errorMessages.fileNotFound}: ${absoluteFilePath}`);
      }

      if (!(await GitService.hasHead(repoPath))) {
        throw new Error(errorMessages.noCommitsYet);
      }

      if (await GitService.isNewFile(filePath, repoPath)) {
        throw new Error(errorMessages.fileNotCommitted);
      }

      const blameOutput = await this.executeGitBlame(filePath, repoPath);
      return parseBlameOutput(blameOutput);
    } catch (error) {
      Logger.error("Error getting blame info:", toError(error));
      throw error;
    }
  }

  private static async executeGitBlame(
    filePath: string,
    repoPath: string,
  ): Promise<string> {
    const { stdout } = await GitService.execGit(
      ["blame", "--line-porcelain", "--", filePath],
      repoPath,
    );
    return stdout;
  }

  private static async getDiff(
    repoPath: string,
    filePath: string,
  ): Promise<string> {
    const { stdout } = await GitService.execGit(
      ["diff", "--unified=0", "--", filePath],
      repoPath,
    );
    return stdout;
  }

  static async analyzeChanges(
    repoPath: string,
    filePath: string,
  ): Promise<string> {
    try {
      // First check if file is deleted or new, as these don't need blame analysis
      // Use git status to check file state
      const normalizedPath = path.normalize(filePath.replace(/^\/+/, ""));

      if (await GitService.isFileDeleted(normalizedPath, repoPath)) {
        Logger.log(
          `Skipping blame analysis for deleted file: ${normalizedPath}`,
        );
        return `Deleted file: ${normalizedPath}`;
      }

      if (await GitService.isNewFile(normalizedPath, repoPath)) {
        Logger.log(
          `Skipping blame analysis for new file: ${normalizedPath}`,
        );
        return `New file: ${normalizedPath}`;
      }

      // For existing files, we need to get blame info
      const blame = await this.getGitBlame(normalizedPath, repoPath);
      const diff = await this.getDiff(repoPath, normalizedPath);
      const changedLines = parseChangedLines(diff);
      const authorChanges = analyzeBlameInfo(blame, changedLines);
      return formatAnalysis(authorChanges);
    } catch (error) {
      Logger.error("Error analyzing changes:", toError(error));
      throw error;
    }
  }

}
