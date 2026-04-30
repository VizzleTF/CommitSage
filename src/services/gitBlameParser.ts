export interface BlameInfo {
    commit: string;
    author: string;
    email: string;
    date: string;
    timestamp: number;
    line: string;
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
            currentBlame.timestamp = parseInt(line.substring(11), 10);
            currentBlame.date = new Date(currentBlame.timestamp * 1000).toISOString();
        } else if (line.startsWith('\t')) {
            currentBlame.line = line.substring(1);
            if (
                currentBlame.author &&
                currentBlame.email &&
                currentBlame.date &&
                currentBlame.timestamp &&
                currentBlame.line
            ) {
                blameInfos.push(currentBlame as BlameInfo);
            }
            currentBlame = {};
        } else if (line.match(/^[0-9a-f]{40}/)) {
            currentBlame.commit = line.split(' ')[0];
        }
    }

    return blameInfos;
}

export function parseChangedLines(diff: string): Set<number> {
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

export function analyzeBlameInfo(
    blame: BlameInfo[],
    changedLines: Set<number>
): Map<string, { count: number; lines: number[] }> {
    const authorChanges = new Map<string, { count: number; lines: number[] }>();

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
