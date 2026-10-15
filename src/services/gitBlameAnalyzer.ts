import * as path from 'node:path';
import { Logger } from '../utils/logger';
import { GitService, isDeletedStatus, isNewStatus } from './gitService';
import { toError } from '../utils/errorUtils';
import {
  formatBlameSummary,
  parseBlameAuthors,
  parseOldLineRanges,
} from './gitBlameParser';

export class GitBlameAnalyzer {
  /**
   * Who last changed the lines this commit modifies. Blames the pre-image in
   * HEAD (the '-' side of the diff): the worktree version of a changed line
   * is always "Not Committed Yet". The caller only runs this when HEAD exists.
   */
  static async analyzeChanges(
    repoPath: string,
    filePath: string,
    knownStatus: string,
    useStagedChanges: boolean,
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

      // Worktree mode diffs against HEAD: the commit stages everything.
      // Literal pathspecs so `[id].tsx` is not also matched as a glob; no
      // color or external diff tool so the hunk headers stay parseable.
      const diffArgs = useStagedChanges
        ? ['--literal-pathspecs', 'diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff', '--', normalizedPath]
        : ['--literal-pathspecs', 'diff', 'HEAD', '--unified=0', '--no-color', '--no-ext-diff', '--', normalizedPath];
      const { stdout: diff } = await GitService.execGit(diffArgs, repoPath, { signal });
      const ranges = parseOldLineRanges(diff);
      if (ranges.length === 0) {
        return '';
      }

      const blameArgs = (...extra: string[]): string[] => [
        '--literal-pathspecs', 'blame', ...extra, '--line-porcelain',
        ...ranges.flatMap((range) => ['-L', range]), 'HEAD', '--', normalizedPath,
      ];
      let blame: string;
      try {
        ({ stdout: blame } = await GitService.execGit(blameArgs(), repoPath, { signal }));
      } catch (error) {
        // A global `blame.ignoreRevsFile` this repo lacks fails every blame;
        // retry without it rather than drop attribution.
        if (!/could not open object name list/.test(toError(error).message)) {
          throw error;
        }
        ({ stdout: blame } = await GitService.execGit(blameArgs('--no-ignore-revs-file'), repoPath, { signal }));
      }
      return formatBlameSummary(normalizedPath, parseBlameAuthors(blame));
    } catch (error) {
      // Cancellation must still bubble up so the workflow aborts.
      if (signal?.aborted) {
        throw error;
      }
      // Blame is auxiliary context — degrade gracefully instead of killing
      // the whole commit-message generation when one file can't be analyzed
      // (binary file, permission issue, etc.).
      Logger.error('Error analyzing changes:', toError(error));
      return '';
    }
  }
}
