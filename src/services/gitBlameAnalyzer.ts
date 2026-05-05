import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/logger';
import { errorMessages } from '../utils/constants';
import { GitService, isDeletedStatus, isNewStatus } from './gitService';
import { toError } from '../utils/errorUtils';
import {
  analyzeBlameInfo,
  formatAnalysis,
  parseBlameOutput,
  parseChangedLines,
} from './gitBlameParser';

export class GitBlameAnalyzer {
  static async analyzeChanges(
    repoPath: string,
    filePath: string,
    knownStatus: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const normalizedPath = path.normalize(filePath.replace(/^\/+/, ''));

      if (isDeletedStatus(knownStatus)) {
        Logger.log(`Skipping blame analysis for deleted file: ${normalizedPath}`);
        return `Deleted file: ${normalizedPath}`;
      }

      if (isNewStatus(knownStatus)) {
        Logger.log(`Skipping blame analysis for new file: ${normalizedPath}`);
        return `New file: ${normalizedPath}`;
      }

      // Defensive checks for the modified-file path. `analyzeChanges` is the
      // sole entry-point now, so they live here rather than inside the
      // (former) getGitBlame helper which used to redo the porcelain status
      // lookup. Existence + `hasHead` cover the cases blame can legitimately
      // fail on without an opaque git error.
      const absoluteFilePath = path.resolve(repoPath, normalizedPath);
      try {
        await fs.access(absoluteFilePath);
      } catch {
        throw new Error(`${errorMessages.fileNotFound}: ${absoluteFilePath}`);
      }
      if (!(await GitService.hasHead(repoPath, signal))) {
        throw new Error(errorMessages.noCommitsYet);
      }

      const { stdout: blameOutput } = await GitService.execGit(
        ['blame', '--line-porcelain', '--', normalizedPath],
        repoPath,
        { signal },
      );
      const blame = parseBlameOutput(blameOutput);
      const { stdout: diff } = await GitService.execGit(
        ['diff', '--unified=0', '--', normalizedPath],
        repoPath,
        { signal },
      );
      const changedLines = parseChangedLines(diff);
      const authorChanges = analyzeBlameInfo(blame, changedLines);
      return formatAnalysis(authorChanges);
    } catch (error) {
      Logger.error('Error analyzing changes:', toError(error));
      throw error;
    }
  }
}
