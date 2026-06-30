// "Gentle" diff truncation for fitting a large combined diff into the prompt
// budget while preserving as much meaning as possible.
//
// The naive approach — `diff.slice(0, max)` — chops mid-line (breaking the last
// hunk) and is front-biased: later files (and whole categories like untracked /
// deleted, which are concatenated last) vanish silently, so the model never
// learns they changed. This module instead:
//   - splits the diff into per-file blocks on `diff --git` boundaries,
//   - keeps every file's header (the model sees ALL changed paths),
//   - truncates low-value "noisy" files first (lockfiles, minified, generated,
//     source maps, snapshots) so they can't crowd out meaningful source changes,
//   - then budgets the rest fairly — small files survive whole, the remainder is
//     shared among the large ones,
//   - cutting each block at a line boundary, never mid-line, with an explicit
//     per-file marker.

const FILE_TRUNCATED_MARKER = '\n…(file diff truncated)\n';
const DIFF_TRUNCATED_MARKER = '\n…(diff truncated)';

// How much of a low-value file we keep when the budget is tight: enough for the
// `diff --git`/hunk headers and a few lines so the model still sees it changed.
const NOISY_FILE_CAP = 400;

// Files whose diff body is rarely useful for writing a commit message: their
// changes are mechanical/generated. We keep their header but truncate them
// first. Matched against the file path from the `diff --git` line. Spans the
// dependency lockfiles of every major language ecosystem plus common codegen
// and build-output conventions.
const NOISY_BASENAMES = new Set([
    // JS / TS
    'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
    'bun.lockb', 'bun.lock', 'deno.lock',
    // PHP / Ruby / Rust / Go / Nix / Elixir
    'composer.lock', 'gemfile.lock', 'cargo.lock', 'go.sum', 'flake.lock', 'mix.lock',
    // Python
    'poetry.lock', 'pipfile.lock', 'pdm.lock', 'uv.lock', 'conda-lock.yml',
    // Dart / Swift / .NET / Java / Haskell
    'pubspec.lock', 'podfile.lock', 'package.resolved', 'packages.lock.json',
    'gradle.lockfile', 'cabal.project.freeze', 'paket.lock',
    // Helm / R / Crystal / C++ / Terraform
    'chart.lock', 'renv.lock', 'shard.lock', 'vcpkg-lock.json', 'conan.lock',
    '.terraform.lock.hcl',
]);
// Suffix-based: minified bundles, source maps, test snapshots, generic lockfiles,
// and cross-language codegen output (protobuf, dart/c# generators, *.generated.*).
const NOISY_PATH =
    /(?:\.min\.(?:js|css|mjs|cjs)|\.map|\.snap|\.lock|\.lockfile|-lock\.json|\.pb\.(?:go|cc|h)|_pb2(?:_grpc)?\.py|\.g\.(?:dart|cs)|\.freezed\.dart|\.designer\.cs|\.generated\.[a-z]+)$/i;
// Build-output / vendored / generated directories across ecosystems.
const NOISY_DIR =
    /(?:^|\/)(?:dist|build|out|target|vendor|node_modules|bower_components|__snapshots__|__pycache__|coverage|obj|gen|generated|\.next|\.nuxt|\.svelte-kit|\.terraform)\//;

/** Path from a block's `diff --git a/<path> b/<path>` header, or '' if absent. */
export function blockPath(block: string): string {
    const unquoted = /(?:^|\n)diff --git a\/(.+?) b\//.exec(block);
    if (unquoted) {
        return unquoted[1];
    }
    const quoted = /(?:^|\n)diff --git "a\/(.+?)" "b\//.exec(block);
    return quoted ? quoted[1] : '';
}

/** True for generated/lock/minified files whose body adds little commit meaning. */
export function isNoisyPath(path: string): boolean {
    if (!path) {
        return false;
    }
    const basename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    return NOISY_BASENAMES.has(basename) || NOISY_PATH.test(path) || NOISY_DIR.test(path);
}

/** Largest prefix of `s` that ends on a line boundary and is ≤ `limit`. */
function sliceAtLineBoundary(s: string, limit: number): string {
    if (s.length <= limit) {
        return s;
    }
    const lastNewline = s.lastIndexOf('\n', limit);
    // No newline within the budget → keep the hard prefix (a single line longer
    // than the budget; rare, e.g. a minified file on one line).
    return s.slice(0, lastNewline > 0 ? lastNewline : limit);
}

/**
 * Split a combined git diff into per-file blocks. Each block starts at a
 * `diff --git ` line; any leading text before the first one (e.g. a
 * `# Staged changes:` category header) is attached to the first block.
 * Returns the whole diff as a single block when no headers are found
 * (e.g. a lone `git diff --no-index` for one untracked file).
 */
export function splitIntoFileBlocks(diff: string): string[] {
    const marker = 'diff --git ';
    const starts: number[] = [];
    if (diff.startsWith(marker)) {
        starts.push(0);
    }
    for (let idx = diff.indexOf('\n' + marker); idx !== -1; idx = diff.indexOf('\n' + marker, idx + 1)) {
        starts.push(idx + 1);
    }
    if (starts.length === 0) {
        return [diff];
    }
    const blocks: string[] = [];
    for (let i = 0; i < starts.length; i++) {
        const end = i + 1 < starts.length ? starts[i + 1] : diff.length;
        blocks.push(diff.slice(starts[i], end));
    }
    // Attach any preamble (a category header before the first file) to block 0.
    if (starts[0] > 0) {
        blocks[0] = diff.slice(0, starts[0]) + blocks[0];
    }
    return blocks;
}

/**
 * Allocate a target length to each block whose sum is ≤ `budget`: blocks that
 * already fit their equal share are kept whole, and the remainder is shared
 * evenly among the larger blocks (water-filling, one pass).
 */
function fairBudgets(lengths: number[], budget: number): number[] {
    const n = lengths.length;
    if (n === 0) {
        return [];
    }
    const equalShare = Math.floor(budget / n);
    const smallTotal = lengths.filter(l => l <= equalShare).reduce((sum, l) => sum + l, 0);
    const largeCount = lengths.filter(l => l > equalShare).length;
    const largeShare = largeCount > 0
        ? Math.max(0, Math.floor((budget - smallTotal) / largeCount))
        : 0;
    return lengths.map(l => (l <= equalShare ? l : largeShare));
}

/** Per-block target lengths, truncating noisy files before meaningful ones. */
function allocateBudgets(blocks: string[], maxLength: number): number[] {
    const lengths = blocks.map(b => b.length);
    const noisy = blocks.map(b => isNoisyPath(blockPath(b)));

    // Tier 1: cap noisy files, keep meaningful files whole.
    const capped = lengths.map((len, i) => (noisy[i] ? Math.min(len, NOISY_FILE_CAP) : len));
    if (capped.reduce((a, b) => a + b, 0) <= maxLength) {
        return capped;
    }

    // Tier 2: meaningful files alone don't fit. Hold noisy files at their cap and
    // fair-share the remaining budget across the meaningful files.
    const noisyAlloc = lengths.map((len, i) => (noisy[i] ? Math.min(len, NOISY_FILE_CAP) : 0));
    const noisyTotal = noisyAlloc.reduce((a, b) => a + b, 0);
    if (noisyTotal < maxLength) {
        const meaningfulIdx = blocks.map((_, i) => i).filter(i => !noisy[i]);
        const meaningfulBudgets = fairBudgets(meaningfulIdx.map(i => lengths[i]), maxLength - noisyTotal);
        const target = [...noisyAlloc];
        meaningfulIdx.forEach((blockIdx, k) => { target[blockIdx] = meaningfulBudgets[k]; });
        return target;
    }

    // Tier 3: even the capped noisy files overflow (a diff that is almost all
    // lockfiles). Fall back to a plain fair share across everything.
    return fairBudgets(lengths, maxLength);
}

function renderBlock(block: string, budget: number): string {
    if (block.length <= budget) {
        return block;
    }
    return sliceAtLineBoundary(block, Math.max(0, budget - FILE_TRUNCATED_MARKER.length)) + FILE_TRUNCATED_MARKER;
}

/**
 * Truncate `diff` to roughly `maxLength` characters, preserving every changed
 * file's header, truncating low-value files first, and sharing the rest fairly.
 * Returns the diff unchanged when it already fits (and when `maxLength` is
 * non-finite, i.e. the "no limit" setting).
 */
export function truncateDiff(diff: string, maxLength: number): string {
    if (diff.length <= maxLength) {
        return diff;
    }

    const blocks = splitIntoFileBlocks(diff);

    // Single block (one giant file, or an unrecognized shape): line-boundary cut.
    if (blocks.length <= 1) {
        return sliceAtLineBoundary(diff, maxLength) + DIFF_TRUNCATED_MARKER;
    }

    const budgets = allocateBudgets(blocks, maxLength);
    return blocks.map((block, i) => renderBlock(block, budgets[i])).join('');
}
