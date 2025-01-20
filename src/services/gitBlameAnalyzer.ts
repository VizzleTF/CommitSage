import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../utils/logger';
import { errorMessages } from '../utils/constants';

interface BlameInfo {
    commit: string;
    author: string;
    date: string;
    line: string;
}

interface GitProcessResult<T> {
    data: T;
    stderr: string[];
}

export class GitBlameAnalyzer {
    private static async executeGitCommand<T>(
        command: string[],
        filePath: string,
        processOutput: (data: Buffer) => T,
        ignoreFileNotFound = false
    ): Promise<GitProcessResult<T>> {
        if (!ignoreFileNotFound && !fs.existsSync(filePath)) {
            throw new Error(`${errorMessages.fileNotFound}: ${filePath}`);
        }

        return new Promise((resolve, reject) => {
            const gitProcess = spawn('git', command, {
                cwd: path.dirname(filePath)
            });

            let result: T;
            const stderr: string[] = [];

            gitProcess.stdout.on('data', (data: Buffer) => {
                result = processOutput(data);
            });

            gitProcess.stderr.on('data', (data: Buffer) => {
                const errorMessage = data.toString();
                stderr.push(errorMessage);
                void Logger.error(`Git command stderr: ${errorMessage}`);
            });

            gitProcess.on('close', (code) => {
                if (code === 0 || (ignoreFileNotFound && code === 128)) {
                    resolve({ data: result, stderr });
                } else {
                    reject(new Error(`Git process exited with code ${code}`));
                }
            });
        });
    }

    private static async getGitBlame(filePath: string): Promise<BlameInfo[]> {
        if (!fs.existsSync(filePath)) {
            void Logger.log(`Skipping blame for non-existent file: ${filePath}`);
            return [];
        }

        const processBlameOutput = (data: Buffer): BlameInfo[] => {
            const blame: BlameInfo[] = [];
            let currentBlame: Partial<BlameInfo> = {};

            const lines = data.toString().split('\n');
            lines.forEach((line: string) => {
                if (line.startsWith('author ')) {
                    currentBlame.author = line.substring(7);
                } else if (line.startsWith('committer-time ')) {
                    currentBlame.date = new Date(parseInt(line.substring(15)) * 1000).toISOString();
                } else if (line.startsWith('\t')) {
                    currentBlame.line = line.substring(1);
                    blame.push(currentBlame as BlameInfo);
                    currentBlame = {};
                } else if (line.match(/^[0-9a-f]{40}/)) {
                    currentBlame.commit = line.split(' ')[0];
                }
            });

            return blame;
        };

        const { data } = await this.executeGitCommand(
            ['blame', '--line-porcelain', path.basename(filePath)],
            filePath,
            processBlameOutput
        );

        return data;
    }

    private static async getDiff(repoPath: string, filePath: string): Promise<string> {
        const processDiffOutput = (data: Buffer): string => data.toString();

        try {
            const { data } = await this.executeGitCommand(
                ['diff', '--', path.basename(filePath)],
                filePath,
                processDiffOutput,
                true // Ignore if file doesn't exist (for moved/deleted files)
            );

            return data;
        } catch (error) {
            void Logger.log(`Could not get diff for ${filePath}, might be moved/deleted`);
            return '';
        }
    }

    static async analyzeChanges(repoPath: string, filePath: string): Promise<string> {
        try {
            void Logger.log(`Analyzing changes for file: ${filePath}`);

            const blame = await this.getGitBlame(filePath);
            void Logger.log(`Git blame completed for ${filePath}`);

            const diff = await this.getDiff(repoPath, filePath);
            void Logger.log(`Git diff completed for ${filePath}`);

            if (!blame.length && !diff) {
                return `File ${path.basename(filePath)} was moved or deleted`;
            }

            const changedLines = this.parseChangedLines(diff);
            const blameAnalysis = this.analyzeBlameInfo(blame, changedLines);

            return this.formatAnalysis(blameAnalysis);
        } catch (error) {
            void Logger.error('Error in GitBlameAnalyzer:', error as Error);
            throw error;
        }
    }

    private static parseChangedLines(diff: string): Set<number> {
        const changedLines = new Set<number>();
        const lines = diff.split('\n');
        let currentLine = 0;

        for (const line of lines) {
            if (line.startsWith('@@')) {
                const match = line.match(/@@ -\d+,\d+ \+(\d+),\d+ @@/);
                if (match) {
                    currentLine = parseInt(match[1]) - 1;
                }
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                changedLines.add(currentLine);
                currentLine++;
            } else if (!line.startsWith('-')) {
                currentLine++;
            }
        }

        return changedLines;
    }

    private static analyzeBlameInfo(blame: BlameInfo[], changedLines: Set<number>): Map<string, { count: number, lines: number[] }> {
        const authorChanges = new Map<string, { count: number, lines: number[] }>();

        changedLines.forEach(lineNumber => {
            const blameInfo = blame[lineNumber - 1];
            if (blameInfo) {
                const authorData = authorChanges.get(blameInfo.author) || { count: 0, lines: [] };
                authorData.count++;
                authorData.lines.push(lineNumber);
                authorChanges.set(blameInfo.author, authorData);
            }
        });

        return authorChanges;
    }

    private static formatAnalysis(analysis: Map<string, { count: number, lines: number[] }>): string {
        let result = "Change Analysis based on Git Blame:\n\n";

        analysis.forEach((data, author) => {
            result += `Author: ${author}\n`;
            result += `Changed Lines: ${data.count}\n`;
            result += `Line Numbers: ${data.lines.join(', ')}\n\n`;
        });

        return result;
    }
}