/**
 * `-L start,end` ranges of the pre-image lines a `--unified=0` diff touches,
 * read from the `@@ -start[,count] +… @@` hunk headers. A pure addition
 * (count 0) has no old lines, so it yields no range.
 */
export function parseOldLineRanges(diff: string): string[] {
    const ranges: string[] = [];
    for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+/gm)) {
        const start = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        if (count > 0) {
            ranges.push(`${start},${start + count - 1}`);
        }
    }
    return ranges;
}

/**
 * One author name per blamed line of `git blame --line-porcelain` output:
 * every entry repeats its `author` header, and its content line starts with
 * a tab. An entry cut off by the output cap (no content line) is not counted.
 */
export function parseBlameAuthors(porcelain: string): string[] {
    const authors: string[] = [];
    let author = '';
    for (const line of porcelain.split('\n')) {
        if (line.startsWith('author ')) {
            author = line.substring(7);
        } else if (line.startsWith('\t')) {
            authors.push(author);
        }
    }
    return authors;
}

/**
 * "src/a.ts: modifies lines last changed by Alice (5), Bob (2)" — authors
 * ranked by line count; '' when nothing was blamed.
 */
export function formatBlameSummary(file: string, authors: string[]): string {
    if (authors.length === 0) {
        return '';
    }
    const counts = new Map<string, number>();
    for (const author of authors) {
        counts.set(author, (counts.get(author) ?? 0) + 1);
    }
    const ranked = [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([author, count]) => `${author} (${count})`);
    return `${file}: modifies lines last changed by ${ranked.join(', ')}`;
}
