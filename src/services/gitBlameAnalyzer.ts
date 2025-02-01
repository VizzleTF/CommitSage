import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger';
import { errorMessages } from '../utils/constants';
import { GitService } from './gitService';

interface BlameInfo {
    commit: string;
    author: string;
    email: string;
    date: string;
    timestamp: number;
    line: string;
}

export class GitBlameAnalyzer {
    private static async isNewFile(filePath: string, repoPath: string): Promise<boolean> {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }

            const { stdout } = await GitService.execGit(['ls-files', path.relative(repoPath, filePath)], repoPath);
            return !stdout.trim();
        } catch (error) {
            void Logger.error('Error checking if file is new:', error as Error);
            return true;
        }
    }

    private static async hasHead(repoPath: string): Promise<boolean> {
        try {
            const { stdout } = await GitService.execGit(['rev-parse', 'HEAD'], repoPath);
            return !!stdout.trim();
        } catch {
            return false;
        }
    }

    private static async getGitBlame(filePath: string, repoPath: string): Promise<BlameInfo[]> {
        try {
            const absoluteFilePath = path.resolve(repoPath, filePath);
            if (!fs.existsSync(absoluteFilePath)) {
                throw new Error(`${errorMessages.fileNotFound}: ${absoluteFilePath}`);
            }

            if (!await GitService.hasHead(repoPath)) {
                throw new Error(errorMessages.noCommitsYet);
            }

            if (await GitService.isNewFile(filePath, repoPath)) {
                throw new Error(errorMessages.fileNotCommitted);
            }

            const blameOutput = await this.executeGitBlame(filePath, repoPath);
            return this.parseBlameOutput(blameOutput);
        } catch (error) {
            void Logger.error('Error getting blame info:', error as Error);
            throw error;
        }
    }

    private static async executeGitBlame(filePath: string, repoPath: string): Promise<string> {
        const { stdout } = await GitService.execGit(['blame', '--line-porcelain', filePath], repoPath);
        return stdout;
    }

    private static parseBlameOutput(blameOutput: string): BlameInfo[] {
        const lines = blameOutput.split('\n');
        const blameInfos: BlameInfo[] = [];
        let currentBlame: Partial<BlameInfo> = {};

        for (const line of lines) {
            if (line.startsWith('author ')) {
                currentBlame.author = line.substring(7);
            } else if (line.startsWith('author-mail ')) {
                currentBlame.email = line.substring(12).replace(/[<>]/g, '');
            } else if (line.startsWith('author-time ')) {
                currentBlame.timestamp = parseInt(line.substring(11), 10);
                currentBlame.date = new Date(currentBlame.timestamp * 1000).toISOString();
            } else if (line.startsWith('\t')) {
                currentBlame.line = line.substring(1);
                if (currentBlame.author && currentBlame.email && currentBlame.date && currentBlame.timestamp && currentBlame.line) {
                    blameInfos.push(currentBlame as BlameInfo);
                }
                currentBlame = {};
            } else if (line.match(/^[0-9a-f]{40}/)) {
                currentBlame.commit = line.split(' ')[0];
            }
        }

        return blameInfos;
    }

    private static async getDiff(repoPath: string, filePath: string): Promise<string> {
        const { stdout } = await GitService.execGit(['diff', '--unified=0', filePath], repoPath);
        return stdout;
    }

    static async analyzeChanges(repoPath: string, filePath: string): Promise<string> {
        try {
            // First check if file is deleted or new, as these don't need blame analysis
            // Use git status to check file state
            const normalizedPath = path.normalize(filePath.replace(/^\/+/, ''));

            if (await GitService.isFileDeleted(normalizedPath, repoPath)) {
                void Logger.log(`Skipping blame analysis for deleted file: ${normalizedPath}`);
                return `Deleted file: ${normalizedPath}`;
            }

            if (await GitService.isNewFile(normalizedPath, repoPath)) {
                void Logger.log(`Skipping blame analysis for new file: ${normalizedPath}`);
                return `New file: ${normalizedPath}`;
            }

            // For existing files, we need to get blame info
            const blame = await this.getGitBlame(normalizedPath, repoPath);
            const diff = await this.getDiff(repoPath, normalizedPath);
            const changedLines = this.parseChangedLines(diff);
            const authorChanges = this.analyzeBlameInfo(blame, changedLines);
            return this.formatAnalysis(authorChanges);
        } catch (error) {
            void Logger.error('Error analyzing changes:', error as Error);
            throw error;
        }
    }

    private static parseChangedLines(diff: string): Set<number> {
        const changedLines = new Set<number>();
        const lines = diff.split('\n');
        let currentLine = 0;

        for (const line of lines) {
            const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (match) {
                currentLine = parseInt(match[1], 10);
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                changedLines.add(currentLine);
                currentLine++;
            } else if (!line.startsWith('-') && !line.startsWith('---')) {
                currentLine++;
            }
        }

        return changedLines;
    }

    private static analyzeBlameInfo(blame: BlameInfo[], changedLines: Set<number>): Map<string, { count: number, lines: number[] }> {
        const authorChanges = new Map<string, { count: number, lines: number[] }>();

        blame.forEach((info, index) => {
            if (changedLines.has(index + 1)) {
                const key = `${info.author} <${info.email}>`;
                const current = authorChanges.get(key) || { count: 0, lines: [] };
                current.count++;
                current.lines.push(index + 1);
                authorChanges.set(key, current);
            }
        });

        return authorChanges;
    }

    private static formatAnalysis(authorChanges: Map<string, { count: number, lines: number[] }>): string {
        if (authorChanges.size === 0) {
            return 'No changes detected.';
        }

        const sortedAuthors = Array.from(authorChanges.entries())
            .sort((a, b) => b[1].count - a[1].count);

        return sortedAuthors.map(([author, { count, lines }]) =>
            `${author} modified ${count} line${count === 1 ? '' : 's'} (${lines.join(', ')})`
        ).join('\n');
    }

    public async getBlameInfo(filePath: string, repoPath: string): Promise<BlameInfo[]> {
        try {
            if (!await GitService.hasHead(repoPath)) {
                throw new Error(errorMessages.noCommitsYet);
            }

            if (await GitService.isNewFile(filePath, repoPath)) {
                throw new Error(errorMessages.fileNotCommitted);
            }

            if (await GitService.isFileDeleted(filePath, repoPath)) {
                throw new Error(errorMessages.fileDeleted);
            }

            const blameOutput = await GitBlameAnalyzer.executeGitBlame(filePath, repoPath);
            return GitBlameAnalyzer.parseBlameOutput(blameOutput);
        } catch (error) {
            void Logger.error('Error getting blame info:', error as Error);
            throw error;
        }
    }
}