const C_ESCAPES: Record<string, string> = {
    a: '\u0007',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
};

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
        /* v8 ignore next -- `?? 0` is a type guard; codePointAt(0) on a
           non-empty iterated char is always defined, so the fallback is dead. */
        const bytes = new Uint8Array([...unquoted].map((c) => c.codePointAt(0) ?? 0));
        unquoted = new TextDecoder('utf-8').decode(bytes);
    } catch {
        // Caller logs; we still return best-effort result
    }

    // Remaining C-style escapes, in one pass so that a literal backslash
    // (`\\t`) unescapes to `\t` instead of a tab. Paths with a tab or newline
    // in the name used to keep the raw `\t` / `\n` text, which then failed to
    // match as a pathspec and silently dropped that file from the diff.
    unquoted = unquoted.replaceAll(
        /\\(.)/g,
        (_, ch: string) => C_ESCAPES[ch] ?? ch,
    );
    return unquoted;
}
