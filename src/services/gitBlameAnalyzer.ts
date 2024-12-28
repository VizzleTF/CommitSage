import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface BlameInfo {
    commit: string;
    author: string;
    date: string;
    line: string;
}

export class GitBlameAnalyzer {
    private static async getGitBlame(filePath: string): Promise<BlameInfo[]> {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(filePath)) {
                reject(new Error(`File does not exist: ${filePath}`));
                return;
            }

            const blame: BlameInfo[] = [];
            const gitProcess = spawn('git', ['blame', '--line-porcelain', path.basename(filePath)], {
                cwd: path.dirname(filePath)
            });

            let currentBlame: Partial<BlameInfo> = {};

            gitProcess.stdout.on('data', (data: Buffer) => {
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
            });

            gitProcess.stderr.on('data', (data: Buffer) => {
                console.error(`Git blame stderr: ${data.toString()}`);
            });

            gitProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(blame);
                } else {
                    reject(new Error(`Git blame process exited with code ${code}`));
                }
            });
        });
    }

    private static async getDiff(repoPath: string, filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const gitProcess = spawn('git', ['diff', '--', path.basename(filePath)], { cwd: path.dirname(filePath) });
            let diff = '';

            gitProcess.stdout.on('data', (data: Buffer) => {
                diff += data.toString();
            });

            gitProcess.stderr.on('data', (data: Buffer) => {
                console.error(`Git diff stderr: ${data.toString()}`);
            });

            gitProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(diff);
                } else {
                    reject(new Error(`Git diff process exited with code ${code}`));
                }
            });
        });
    }

    static async analyzeChanges(repoPath: string, filePath: string): Promise<string> {
        try {
            console.log(`Analyzing changes for file: ${filePath}`);

            if (!fs.existsSync(filePath)) {
                throw new Error(`File does not exist: ${filePath}`);
            }

            const blame = await this.getGitBlame(filePath);
            console.log(`Git blame completed for ${filePath}`);

            const diff = await this.getDiff(repoPath, filePath);
            console.log(`Git diff completed for ${filePath}`);

            const changedLines = this.parseChangedLines(diff);
            const blameAnalysis = this.analyzeBlameInfo(blame, changedLines);

            return this.formatAnalysis(blameAnalysis);
        } catch (error) {
            console.error('Error in GitBlameAnalyzer:', error);
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

// Usage in the extension
export async function analyzeFileChanges(filePath: string): Promise<string> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!workspaceFolder) {
        throw new Error('File is not part of a workspace');
    }

    try {
        return await GitBlameAnalyzer.analyzeChanges(workspaceFolder.uri.fsPath, filePath);
    } catch (error) {
        console.error(`Error analyzing file changes for ${filePath}:`, error);
        return `Unable to analyze changes for ${filePath}: ${(error as Error).message}`;
    }
}