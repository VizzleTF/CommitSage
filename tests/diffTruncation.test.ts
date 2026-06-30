import { describe, it, expect } from 'vitest';
import { truncateDiff, splitIntoFileBlocks, isNoisyPath, blockPath } from '../src/utils/diffTruncation';

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
