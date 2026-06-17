export interface BlameInfo {
    commit: string;
    author: string;
    email: string;
    date: string;
    timestamp: number;
    line: string;
    /** Line number in the final (current) version of the file, 1-indexed. */
    lineNumber: number;
}

export function parseBlameOutput(blameOutput: string): BlameInfo[] {
    const lines = blameOutput.split('\n');
    const blameInfos: BlameInfo[] = [];
    let currentBlame: Partial<BlameInfo> = {};

    for (const line of lines) {
        if (line.startsWith('author ')) {
            currentBlame.author = line.substring(7);
        } else if (line.startsWith('author-mail ')) {
            currentBlame.email = line.substring(12).replace(/[<>]/g, '');
        } else if (line.startsWith('author-time ')) {
            currentBlame.timestamp = Number.parseInt(line.substring(11), 10);
            currentBlame.date = new Date(currentBlame.timestamp * 1000).toISOString();
        } else if (line.startsWith('\t')) {
            currentBlame.line = line.substring(1);
            if (
                currentBlame.author &&
                currentBlame.email &&
                currentBlame.date &&
                currentBlame.timestamp &&
                currentBlame.line &&
                currentBlame.lineNumber !== undefined
            ) {
                blameInfos.push(currentBlame as BlameInfo);
            }
            currentBlame = {};
        } else {
            // Header line of a blame entry:  <40-hex-sha> <orig> <final> [count]
            const match = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line);
            if (match) {
                currentBlame.commit = match[1];
                currentBlame.lineNumber = Number.parseInt(match[2], 10);
            }
        }
    }

    return blameInfos;
}

export function parseChangedLines(diff: string): Set<number> {
    const changedLines = new Set<number>();
    const lines = diff.split('\n');
    let currentLine = 0;

    for (const line of lines) {
        const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (match) {
            currentLine = Number.parseInt(match[1], 10);
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            changedLines.add(currentLine);
            currentLine++;
        } else if (!line.startsWith('-') && !line.startsWith('---')) {
            currentLine++;
        }
    }

    return changedLines;
}

export function analyzeBlameInfo(
    blame: BlameInfo[],
    changedLines: Set<number>
): Map<string, { count: number; lines: number[] }> {
    const authorChanges = new Map<string, { count: number; lines: number[] }>();

    for (const info of blame) {
        if (changedLines.has(info.lineNumber)) {
            const key = `${info.author} <${info.email}>`;
            const current = authorChanges.get(key) || { count: 0, lines: [] };
            current.count++;
            current.lines.push(info.lineNumber);
            authorChanges.set(key, current);
        }
    }

    return authorChanges;
}

export function formatAnalysis(
    authorChanges: Map<string, { count: number; lines: number[] }>
): string {
    if (authorChanges.size === 0) {
        return 'No changes detected.';
    }

    const sortedAuthors = Array.from(authorChanges.entries()).sort(
        (a, b) => b[1].count - a[1].count
    );

    return sortedAuthors
        .map(
            ([author, { count, lines }]) =>
                `${author} modified ${count} line${count === 1 ? '' : 's'} (${lines.join(', ')})`
        )
        .join('\n');
}
