/**
 * Unquotes a file path returned by git.
 * Git quotes paths containing spaces or special characters (including Unicode).
 * Unicode characters are escaped as octal sequences (e.g., ⚡ → \342\232\241).
 */
export function unquoteGitPath(filePath: string): string {
    if (!filePath.startsWith('"') || !filePath.endsWith('"')) {
        return filePath;
    }
    let unquoted = filePath.slice(1, -1);

    unquoted = unquoted.replaceAll(/\\([0-7]{3})/g, (_, octal) => {
        return String.fromCodePoint(Number.parseInt(octal, 8));
    });

    try {
        const bytes = new Uint8Array([...unquoted].map((c) => c.codePointAt(0) ?? 0));
        unquoted = new TextDecoder('utf-8').decode(bytes);
    } catch {
        // Caller logs; we still return best-effort result
    }

    unquoted = unquoted.replaceAll(/\\"/g, '"');
    unquoted = unquoted.replaceAll(/\\\\/g, '\\');
    return unquoted;
}
