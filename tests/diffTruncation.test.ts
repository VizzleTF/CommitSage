import { describe, it, expect } from 'vitest';
import { truncateDiff, splitIntoFileBlocks, isNoisyPath, blockPath, resolveMaxDiffLength, capBlameAnalysis, packFileBlocks, fileList, collapseBase64, stripHeaderLines, collapseMovedLines, summarizeRemovedLines, collapseFileMoves } from '../src/utils/diffTruncation';

function fileBlock(path: string, bodyLines: number): string {
    const body = Array.from({ length: bodyLines }, (_, i) => `+line ${i} of ${path}`).join('\n');
    return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,${bodyLines} +1,${bodyLines} @@\n${body}\n`;
}

/** Every newline-delimited line of `out` must be a complete line of `src` (no mid-line cut). */
function everyLineComplete(out: string, src: string, markers: string[]): void {
    const srcLines = new Set(src.split('\n'));
    for (const line of out.split('\n')) {
        if (line === '' || markers.includes(line) || markers.some(m => m.includes(line))) {
            continue;
        }
        expect(srcLines.has(line), `line not found verbatim in source: ${JSON.stringify(line)}`).toBe(true);
    }
}

describe('truncateDiff', () => {
    it('returns the diff unchanged when it fits', () => {
        const diff = fileBlock('a.ts', 3);
        expect(truncateDiff(diff, 10_000)).toBe(diff);
    });

    it('returns the diff unchanged when maxLength is non-finite (no-limit setting)', () => {
        const diff = fileBlock('a.ts', 1000);
        expect(truncateDiff(diff, Number.POSITIVE_INFINITY)).toBe(diff);
    });

    it('cuts a single oversized file at a line boundary, never mid-line', () => {
        const diff = fileBlock('big.ts', 500);
        const out = truncateDiff(diff, 300);
        expect(out.length).toBeLessThan(diff.length);
        expect(out).toContain('…(diff truncated)');
        // The header survives so the model knows which file changed.
        expect(out).toContain('diff --git a/big.ts b/big.ts');
        everyLineComplete(out, diff, ['…(diff truncated)']);
    });

    it('keeps EVERY file header when truncating a multi-file diff (no silent file drop)', () => {
        const diff = [
            fileBlock('first.ts', 2),
            fileBlock('second.ts', 400),
            fileBlock('third.ts', 2),
        ].join('');
        const out = truncateDiff(diff, 400);
        // The naive slice(0, max) would drop third.ts entirely; here all survive.
        expect(out).toContain('diff --git a/first.ts b/first.ts');
        expect(out).toContain('diff --git a/second.ts b/second.ts');
        expect(out).toContain('diff --git a/third.ts b/third.ts');
        expect(out).toContain('…(file diff truncated)');
    });

    it('keeps small files whole and truncates only the large one (fair budget)', () => {
        const small = fileBlock('small.ts', 2);
        const big = fileBlock('big.ts', 1000);
        const out = truncateDiff(small + big, small.length + 200);
        // Small file fully preserved (its last content line present).
        expect(out).toContain('+line 1 of small.ts');
        // Big file truncated with a marker.
        expect(out).toContain('…(file diff truncated)');
        everyLineComplete(out, small + big, ['…(file diff truncated)']);
    });

    it('does not split a multi-byte character across the cut', () => {
        // A line of emoji well past a small budget; cut must land on the newline.
        const diff = `diff --git a/u.ts b/u.ts\n@@ -1 +1 @@\n+${'😀'.repeat(50)}\n+tail\n`;
        const out = truncateDiff(diff, 40);
        // No lone surrogate halves: re-encoding round-trips cleanly.
        expect(out).toBe(Buffer.from(out, 'utf8').toString('utf8'));
        everyLineComplete(out, diff, ['…(diff truncated)']);
    });
});

describe('isNoisyPath (cross-language low-value files)', () => {
    it.each([
        'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'deno.lock',
        'Cargo.lock', 'go.sum', 'composer.lock', 'Gemfile.lock', 'poetry.lock',
        'Pipfile.lock', 'uv.lock', 'pubspec.lock', 'Podfile.lock', 'Package.resolved',
        'packages.lock.json', 'gradle.lockfile', 'mix.lock', 'flake.lock', 'renv.lock',
        '.terraform.lock.hcl',
        'src/app.min.js', 'styles.min.css', 'bundle.js.map', 'Component.test.ts.snap',
        'api/service.pb.go', 'proto/user_pb2.py', 'models/user.g.dart', 'Foo.designer.cs',
        'lib/config.generated.ts',
        'dist/main.js', 'build/output.o', 'target/release/app', 'vendor/lib.go',
        'node_modules/x/index.js', 'coverage/lcov.info', '.next/static/chunk.js',
    ])('treats %s as noisy', (path) => {
        expect(isNoisyPath(path)).toBe(true);
    });

    it.each([
        'src/index.ts', 'lib/parser.go', 'app/models/user.rb', 'main.rs',
        'cmd/server/main.go', 'README.md', 'package.json', 'Cargo.toml',
        'pyproject.toml', 'src/components/Button.tsx',
    ])('treats %s as meaningful', (path) => {
        expect(isNoisyPath(path)).toBe(false);
    });

    it('extracts the path from a diff --git header', () => {
        expect(blockPath('diff --git a/src/x.ts b/src/x.ts\n@@\n')).toBe('src/x.ts');
        expect(blockPath('# Staged changes:\ndiff --git a/go.sum b/go.sum\n@@\n')).toBe('go.sum');
    });
});

describe('truncateDiff noisy-file prioritization', () => {
    it('truncates a large lockfile before a small source file', () => {
        const source = fileBlock('src/index.ts', 3);          // small, meaningful
        const lock = fileBlock('package-lock.json', 2000);    // huge, noisy
        const out = truncateDiff(source + lock, source.length + 500);

        // Meaningful source survives whole even though the lockfile is far bigger.
        expect(out).toContain('+line 0 of src/index.ts');
        expect(out).toContain('+line 2 of src/index.ts');
        // Lockfile is truncated (header kept, body cut).
        expect(out).toContain('diff --git a/package-lock.json b/package-lock.json');
        expect(out).toContain('…(file diff truncated)');
    });

    it('keeps meaningful files whole when only noisy files overflow the budget', () => {
        const a = fileBlock('src/a.ts', 5);
        const b = fileBlock('src/b.ts', 5);
        const lock = fileBlock('Cargo.lock', 3000);
        const out = truncateDiff(a + b + lock, a.length + b.length + 600);

        expect(out).toContain('+line 4 of src/a.ts');
        expect(out).toContain('+line 4 of src/b.ts');
        expect(out).toContain('…(file diff truncated)'); // only the lockfile
    });
});

describe('splitIntoFileBlocks', () => {
    it('splits on diff --git boundaries', () => {
        const blocks = splitIntoFileBlocks(fileBlock('a.ts', 1) + fileBlock('b.ts', 1));
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toContain('a/a.ts');
        expect(blocks[1]).toContain('a/b.ts');
    });

    it('attaches a leading category header to the first block', () => {
        const diff = '# Staged changes:\n' + fileBlock('a.ts', 1);
        const blocks = splitIntoFileBlocks(diff);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].startsWith('# Staged changes:\n')).toBe(true);
    });

    it('returns a single block when there is no diff --git header', () => {
        const diff = '# New files:\nsome non-standard content\n';
        expect(splitIntoFileBlocks(diff)).toEqual([diff]);
    });
});

describe('resolveMaxDiffLength', () => {
    it('maps -1 to no limit, junk to the default and clamps the rest', () => {
        expect(resolveMaxDiffLength(-1)).toBe(Number.POSITIVE_INFINITY);
        expect(resolveMaxDiffLength(undefined)).toBe(100000);
        expect(resolveMaxDiffLength(0)).toBe(100000);
        expect(resolveMaxDiffLength(10)).toBe(1000);
        expect(resolveMaxDiffLength(5_000_000)).toBe(1_000_000);
        expect(resolveMaxDiffLength(20000)).toBe(20000);
    });
});

describe('capBlameAnalysis', () => {
    const line = (i: number) => `src/file${i}.ts: modifies lines last changed by Alice (${i})`;
    const blame = Array.from({ length: 200 }, (_, i) => line(i)).join('\n');

    it('keeps a short summary as is', () => {
        expect(capBlameAnalysis(line(1), 100000)).toBe(line(1));
    });

    it('keeps whole lines within a tenth of the diff budget', () => {
        const out = capBlameAnalysis(blame, 20000);
        expect(out.length).toBeLessThanOrEqual(2000);
        expect(blame.startsWith(out + '\n')).toBe(true);
    });

    it('never exceeds the hard cap, even without a diff limit', () => {
        expect(capBlameAnalysis(blame, Number.POSITIVE_INFINITY).length).toBeLessThanOrEqual(4000);
    });

    it('drops the section when not even one line fits', () => {
        // The smallest maxDiffSize (1000) leaves 100 chars for blame.
        const long = `src/${'deep/'.repeat(20)}x.ts: modifies lines last changed by Alice (1)\n${line(2)}`;
        expect(capBlameAnalysis(long, 1000)).toBe('');
    });
});

describe('packFileBlocks', () => {
    it('packs whole blocks in order without exceeding the limit', () => {
        const blocks = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
        expect(packFileBlocks(blocks, 100)).toEqual(['a'.repeat(40) + 'b'.repeat(40), 'c'.repeat(40)]);
    });

    it('truncates a block larger than the limit into a chunk of its own', () => {
        const big = fileBlock('src/big.ts', 200);
        const chunks = packFileBlocks([fileBlock('src/a.ts', 1), big], 1000);
        expect(chunks).toHaveLength(2);
        expect(chunks[1].startsWith('diff --git a/src/big.ts')).toBe(true);
        expect(chunks[1].length).toBeLessThan(1100);
    });
});

describe('fileList', () => {
    it('counts added and removed lines per file and flags generated files', () => {
        const code = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n+more\n';
        const lock = 'diff --git a/package-lock.json b/package-lock.json\n+x\n';
        expect(fileList([code, lock])).toBe('src/a.ts (+2 -1)\npackage-lock.json (+1 -0) generated');
    });
});

describe('collapseBase64', () => {
    it('replaces a long base64 run with its size and keeps short hashes', () => {
        const blob = 'iVBORw0KGgo' + 'A'.repeat(2037);
        const integrity = '"integrity": "sha512-' + 'Ab9+/'.repeat(17) + '=="';
        const diff = `+.logo { background: url(data:image/png;base64,${blob}); }\n+${integrity}\n`;

        expect(collapseBase64(diff)).toBe(`+.logo { background: url(data:image/png;base64,[base64, 2 KB]); }\n+${integrity}\n`);
    });
});

describe('stripHeaderLines', () => {
    it('drops index/---/+++ in file headers only', () => {
        const diff = 'diff --git a/a.md b/a.md\nindex 1..2 100644\n--- a/a.md\n+++ b/a.md\n@@ -1 +1 @@\n--- a/b\n+++ b/c\n'
            + 'diff --git a/n.ts b/n.ts\nnew file mode 100644\nindex 0..3\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1 @@\n+x';
        expect(stripHeaderLines(diff)).toBe('diff --git a/a.md b/a.md\n@@ -1 +1 @@\n--- a/b\n+++ b/c\n'
            + 'diff --git a/n.ts b/n.ts\nnew file mode 100644\n@@ -0,0 +1 @@\n+x');
    });
});

describe('collapseMovedLines', () => {
    // A lone `}` neither counts nor breaks the run.
    const body = ['const alpha = compute(1);', 'const beta = compute(2);', '}', 'const gamma = compute(3);', 'const delta = compute(4);', 'const omega = compute(5);'];

    it('replaces a moved run on both sides with where it went', () => {
        const diff = ['diff --git a/old.ts b/old.ts', '@@ -1,7 +1,1 @@', ...body.map(l => '-' + l), ' keep',
            'diff --git a/new.ts b/new.ts', '@@ -0,0 +1,7 @@', ...body.map(l => '+' + l), '+export const extra = 1;'].join('\n');
        expect(collapseMovedLines(diff)).toBe(['diff --git a/old.ts b/old.ts', '@@ -1,7 +1,1 @@', '-[5 lines moved to new.ts]', ' keep',
            'diff --git a/new.ts b/new.ts', '@@ -0,0 +1,7 @@', '+[5 lines moved from old.ts]', '+export const extra = 1;'].join('\n'));
    });

    it('keeps short runs and changed lines', () => {
        const diff = 'diff --git a/a.ts b/a.ts\n@@ -1,2 +1,2 @@\n-const value = compute(1);\n+const value = compute(2);';
        expect(collapseMovedLines(diff)).toBe(diff);
    });
});

describe('summarizeRemovedLines', () => {
    it('turns the unmoved old lines of a deleted or rewritten file into counts', () => {
        const diff = 'diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n@@ -1,4 +0,0 @@\n-a\n-b\n-[5 lines moved to new.ts]\n-c\n'
            + 'diff --git a/main.ts b/main.ts\ndissimilarity index 90%\n@@ -1,2 +1,1 @@\n-x\n-y\n+z\n'
            + 'diff --git a/kept.ts b/kept.ts\n@@ -1 +1 @@\n-old\n+new';
        expect(summarizeRemovedLines(diff)).toBe('diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n@@ -1,4 +0,0 @@\n-[2 lines removed]\n-[5 lines moved to new.ts]\n-[1 line removed]\n'
            + 'diff --git a/main.ts b/main.ts\ndissimilarity index 90%\n@@ -1,2 +1,1 @@\n-[2 lines removed]\n+z\n'
            + 'diff --git a/kept.ts b/kept.ts\n@@ -1 +1 @@\n-old\n+new');
    });
});

describe('collapseFileMoves', () => {
    it('shows a deleted file whose lines all moved into one new file as a rename', () => {
        const diff = 'diff --git a/a.js b/a.js\ndeleted file mode 100644\n@@ -1,9 +0,0 @@\n-[9 lines moved to a.mjs]\n\\ No newline at end of file\n'
            + 'diff --git a/a.mjs b/a.mjs\nnew file mode 100644\n@@ -0,0 +1,9 @@\n+[9 lines moved from a.js]\n'
            + 'diff --git a/b.ts b/b.ts\n@@ -1 +1 @@\n-x\n+y';
        expect(collapseFileMoves(diff)).toBe('diff --git a/a.js b/a.mjs\nrename from a.js\nrename to a.mjs\n'
            + 'diff --git a/b.ts b/b.ts\n@@ -1 +1 @@\n-x\n+y');
    });

    it('keeps both files when the new one has lines of its own', () => {
        const diff = 'diff --git a/a.js b/a.js\ndeleted file mode 100644\n@@ -1,9 +0,0 @@\n-[9 lines moved to a.mjs]\n'
            + 'diff --git a/a.mjs b/a.mjs\nnew file mode 100644\n@@ -0,0 +1,10 @@\n+[9 lines moved from a.js]\n+export default config;';
        expect(collapseFileMoves(diff)).toBe(diff);
    });
});
