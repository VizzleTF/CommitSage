import * as vscode from 'vscode';
import { spawn } from 'child_process';
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

interface GitProcessResult<T> {
    data: T;
    stderr: string[];
}

export class GitBlameAnalyzer {
    private static async executeGitCommand<T>(
        command: string[],
        filePath: string,
        processOutput: (data: Buffer) => T,
        ignoreFileNotFound = false,
        repoPath: string
    ): Promise<GitProcessResult<T>> {
        if (!ignoreFileNotFound && !fs.existsSync(filePath)) {
            throw new Error(`${errorMessages.fileNotFound}: ${filePath}`);
        }

        const cwd = repoPath;

        return new Promise((resolve, reject) => {
            const gitProcess = spawn('git', command, { cwd });

            let result: T | undefined;
            const stderr: string[] = [];

            gitProcess.stdout.on('data', (data: Buffer) => {
                result = processOutput(data);
            });

            gitProcess.stderr.on('data', (data: Buffer) => {
                const errorMessage = data.toString();
                stderr.push(errorMessage);
                void Logger.error(`Git command stderr: ${errorMessage}`);
            });

            gitProcess.on('error', (error) => {
                void Logger.error(`Git command error: ${error.message}`);
                reject(new Error(`Git command failed: ${error.message}`));
            });

            gitProcess.on('close', (code) => {
                if (code === 0 || (ignoreFileNotFound && code === 128)) {
                    resolve({ data: result ?? processOutput(Buffer.from('')), stderr });
                } else {
                    reject(new Error(`Git process exited with code ${code}`));
                }
            });
        });
    }

    private static async isNewFile(filePath: string, repoPath: string): Promise<boolean> {
        try {
            if (!fs.existsSync(filePath)) {
                return false;
            }

            const processOutput = (data: Buffer): string => data.toString();
            const { data } = await this.executeGitCommand(
                ['ls-files', path.relative(repoPath, filePath)],
                filePath,
                processOutput,
                true,
                repoPath
            );
            return !data.trim();
        } catch (error) {
            void Logger.error('Error checking if file is new:', error as Error);
            return true;
        }
    }

    private static async hasHead(repoPath: string): Promise<boolean> {
        try {
            const processOutput = (data: Buffer): string => data.toString();
            await this.executeGitCommand(
                ['rev-parse', 'HEAD'],
                repoPath,
                processOutput,
                true,
                repoPath
            );
            return true;
        } catch {
            return false;
        }
    }

    private static async getGitBlame(filePath: string, repoPath: string): Promise<BlameInfo[]> {
        try {
            const hasHead = await this.hasHead(repoPath);
            if (!hasHead) {
                void Logger.log(`Skipping blame for repository without HEAD: ${repoPath}`);
                return [];
            }

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
                ['blame', '--line-porcelain', path.relative(repoPath, filePath)],
                filePath,
                processBlameOutput,
                true,
                repoPath
            );

            return data;
        } catch (error) {
            void Logger.error(`Error getting blame for ${filePath}:`, error as Error);
            return [];
        }
    }

    private static async getDiff(repoPath: string, filePath: string): Promise<string> {
        const processDiffOutput = (data: Buffer): string => data.toString();

        try {
            const hasHead = await this.hasHead(repoPath);
            if (!hasHead) {
                return '';
            }

            const relativePath = path.relative(repoPath, filePath);

            const { data } = await this.executeGitCommand(
                ['diff', '--', relativePath],
                filePath,
                processDiffOutput,
                true,
                repoPath
            );

            return data;
        } catch (error) {
            void Logger.error(`Error getting diff for ${filePath}:`, error as Error);
            return '';
        }
    }

    static async analyzeChanges(repoPath: string, filePath: string): Promise<string> {
        try {
            const hasHead = await this.hasHead(repoPath);
            if (!hasHead) {
                void Logger.log(`Skipping blame analysis for repository without HEAD: ${repoPath}`);
                return '';
            }

            const absoluteFilePath = path.resolve(repoPath, filePath);
            if (!fs.existsSync(absoluteFilePath)) {
                void Logger.log(`File does not exist: ${absoluteFilePath}`);
                return '';
            }

            if (await this.isNewFile(absoluteFilePath, repoPath)) {
                void Logger.log(`File is new: ${absoluteFilePath}`);
                return '';
            }

            void Logger.log(`Analyzing changes for file: ${absoluteFilePath}`);
            const blame = await this.getGitBlame(absoluteFilePath, repoPath);

            if (!blame.length) {
                return '';
            }

            const diff = await this.getDiff(repoPath, absoluteFilePath);
            const changedLines = this.parseChangedLines(diff);
            const blameAnalysis = this.analyzeBlameInfo(blame, changedLines);

            return this.formatAnalysis(blameAnalysis);
        } catch (error) {
            void Logger.error('Error in GitBlameAnalyzer:', error as Error);
            return '';
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

    private static formatAnalysis(authorChanges: Map<string, { count: number, lines: number[] }>): string {
        let result = "Change Analysis based on Git Blame:\n\n";

        if (authorChanges.size === 0) {
            return result;
        }

        authorChanges.forEach((data, author) => {
            result += `${author}: modified ${data.count} lines\n`;
            result += `Lines: ${data.lines.join(', ')}\n\n`;
        });

        return result;
    }

    private async executeGitBlame(filePath: string): Promise<string> {
        const { stdout } = await GitService.execGit(['blame', '--line-porcelain', filePath], path.dirname(filePath));
        return stdout;
    }

    private parseBlameOutput(blameOutput: string): BlameInfo[] {
        const lines = blameOutput.split('\n');
        const result: BlameInfo[] = [];
        let currentInfo: Partial<BlameInfo> = {};

        for (const line of lines) {
            if (line.startsWith('author ')) {
                currentInfo.author = line.substring(7);
            } else if (line.startsWith('author-mail ')) {
                currentInfo.email = line.substring(12).replace(/[<>]/g, '');
            } else if (line.startsWith('author-time ')) {
                currentInfo.timestamp = parseInt(line.substring(12), 10);
                const date = new Date(currentInfo.timestamp * 1000);
                currentInfo.date = date.toISOString();
            } else if (line.startsWith('commit ')) {
                currentInfo.commit = line.substring(7);
            } else if (line.startsWith('\t')) {
                currentInfo.line = line.substring(1);
                if (Object.keys(currentInfo).length > 0) {
                    result.push(currentInfo as BlameInfo);
                    currentInfo = {};
                }
            }
        }

        return result;
    }

    public async getBlameInfo(filePath: string, repoPath: string): Promise<BlameInfo[]> {
        if (!await GitService.hasHead(repoPath)) {
            void Logger.log(`Skipping blame analysis for repository without HEAD: ${repoPath}`);
            return [];
        }

        if (await GitService.isNewFile(filePath)) {
            return [];
        }

        if (await GitService.isFileDeleted(filePath)) {
            return [];
        }

        try {
            const blameOutput = await this.executeGitBlame(filePath);
            return this.parseBlameOutput(blameOutput);
        } catch (error) {
            void Logger.error(`Error during blame analysis for ${filePath}:`, error as Error);
            return [];
        }
    }
}