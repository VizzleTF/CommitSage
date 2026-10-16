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
 * `# Unstaged changes:` category header) is attached to the first block.
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

// Fallback if `general.maxDiffSize` is unreadable. ~100k chars covers most
// diffs while staying within safe LLM API context window limits for major
// providers. Tighter caps (e.g. ~20k chars) are needed for low-TPM free
// tiers like Groq free — see the setting's description for guidance.
const DEFAULT_MAX_DIFF_LENGTH = 100000;

/**
 * Clamp a raw `general.maxDiffSize` value to a sane range. `-1` disables
 * truncation (sends the whole diff regardless of size — only useful with
 * very-long-context models). Anything else is clamped to [1000, 1_000_000]
 * so a hand-edited project config can't either send an empty prompt or
 * overflow JSON.stringify.
 */
export function resolveMaxDiffLength(raw: unknown): number {
    if (raw === -1) {
        return Number.POSITIVE_INFINITY;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        return DEFAULT_MAX_DIFF_LENGTH;
    }
    return Math.max(1000, Math.min(1_000_000, raw));
}

// Blame is secondary context: it never takes more than this, nor more than a
// tenth of the diff budget.
const MAX_BLAME_LENGTH = 4000;

/** Keep whole lines of the blame summary within its share of `maxDiffLength`. */
export function capBlameAnalysis(blame: string, maxDiffLength: number): string {
    const cap = Math.min(MAX_BLAME_LENGTH, maxDiffLength / 10);
    if (blame.length <= cap) {
        return blame;
    }
    const lastNewline = blame.lastIndexOf('\n', cap);
    // No whole line fits (tiny maxDiffSize) → drop the section.
    return lastNewline > 0 ? blame.slice(0, lastNewline) : '';
}

/**
 * Packs whole file blocks, in order, into chunks of at most `max` characters
 * for summarizing; a block larger than `max` is truncated into its own chunk.
 */
export function packFileBlocks(blocks: string[], max: number): string[] {
    const chunks: string[] = [];
    let current = '';
    for (const block of blocks) {
        const piece = block.length > max ? truncateDiff(block, max) : block;
        if (current && current.length + piece.length > max) {
            chunks.push(current);
            current = '';
        }
        current += piece;
    }
    if (current) {
        chunks.push(current);
    }
    return chunks;
}

/** One `path (+added -removed)` line per file block; generated files are flagged. */
export function fileList(blocks: string[]): string {
    return blocks.map(block => {
        let added = 0;
        let removed = 0;
        for (const line of block.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                added++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                removed++;
            }
        }
        const path = blockPath(block);
        return `${path} (+${added} -${removed})${isNoisyPath(path) ? ' generated' : ''}`;
    }).join('\n');
}

// Encoded blobs (inline images, fonts, notebook plots) cost tokens and say
// nothing a commit message needs; small models even describe them as changes.
const BASE64_RUN = /[A-Za-z0-9+/]{200,}={0,2}/g;

/** Replaces each base64 run with a size note. */
export function collapseBase64(diff: string): string {
    return diff.replace(BASE64_RUN, run => `[base64, ${Math.round(run.length * 0.75 / 1024)} KB]`);
}

/**
 * Drops the `index`, `---` and `+++` lines of each file header: `diff --git`
 * already names the file, and `new file` / `deleted file` lines stay.
 */
export function stripHeaderLines(diff: string): string {
    let inHeader = false;
    return diff.split('\n').filter(line => {
        if (line.startsWith('diff --git ')) {
            inHeader = true;
        } else if (line.startsWith('@@')) {
            inHeader = false;
        }
        return !(inHeader && /^(?:index |--- |\+\+\+ )/.test(line));
    }).join('\n');
}

// A run this long of removed lines that reappear as added ones (or the other
// way round) is moved code: the model needs where it went, not every line.
// Lines shorter than MIN_MOVED_CHARS (`}`, `return;`) match anywhere, so they
// neither count nor break a run.
const MIN_MOVED_LINES = 5;
const MIN_MOVED_CHARS = 8;

const lineCount = (n: number): string => `${n} ${n === 1 ? 'line' : 'lines'}`;

/** Collapses runs of moved lines into `+[N lines moved from <path>]` / `-[N lines moved to <path>]`. */
export function collapseMovedLines(diff: string): string {
    const lines = diff.split('\n');
    const isChange = (line: string): boolean => line.startsWith('+') || line.startsWith('-');
    const text = (line: string): string => line.slice(1).trim();
    // Trimmed line -> the file it first appears in, per side.
    const added = new Map<string, string>();
    const removed = new Map<string, string>();
    const side = (sign: string): Map<string, string> => (sign === '+' ? added : removed);
    let path = '';
    for (const line of lines) {
        if (line.startsWith('diff --git ')) {
            path = blockPath(line);
        } else if (isChange(line) && text(line).length >= MIN_MOVED_CHARS && !side(line[0]).has(text(line))) {
            side(line[0]).set(text(line), path);
        }
    }
    const out: string[] = [];
    for (let i = 0; i < lines.length;) {
        const sign = lines[i][0];
        if (isChange(lines[i])) {
            const other = side(sign === '+' ? '-' : '+');
            let end = i;
            while (end < lines.length && lines[end][0] === sign
                && (text(lines[end]).length < MIN_MOVED_CHARS || other.has(text(lines[end])))) {
                end++;
            }
            const moved = lines.slice(i, end).map(text).filter(t => t.length >= MIN_MOVED_CHARS);
            if (moved.length >= MIN_MOVED_LINES) {
                const paths = [...new Set(moved.map(t => other.get(t)))].join(', ');
                out.push(`${sign}[${lineCount(moved.length)} moved ${sign === '+' ? 'from' : 'to'} ${paths}]`);
                i = end;
                continue;
            }
        }
        out.push(lines[i]);
        i++;
    }
    return out.join('\n');
}

/**
 * In a deleted or fully rewritten file (`git diff -B`), the old lines that did
 * not move elsewhere become one `-[N lines removed]` note per run: the model
 * needs that they went away, not what they said.
 */
export function summarizeRemovedLines(diff: string): string {
    return splitIntoFileBlocks(diff).map(block => {
        if (!/\n(?:deleted file mode|dissimilarity index)/.test(block.split('\n@@')[0])) {
            return block;
        }
        const out: string[] = [];
        let run = 0;
        for (const line of block.split('\n')) {
            if (line.startsWith('-') && !/^-\[\d+ lines? moved /.test(line)) {
                run++;
                continue;
            }
            if (run) {
                out.push(`-[${lineCount(run)} removed]`);
                run = 0;
            }
            out.push(line);
        }
        if (run) {
            out.push(`-[${lineCount(run)} removed]`);
        }
        return out.join('\n');
    }).join('');
}

/** A block's lines after its first hunk header, minus `\ No newline` notes. */
function bodyLines(block: string): string[] {
    const at = block.indexOf('\n@@');
    if (at === -1) {
        return [];
    }
    return block.slice(at + 1).split('\n').slice(1).filter(line => line && !line.startsWith('\\'));
}

/**
 * A deleted file whose every line moved into one new file, and that new file
 * holds nothing else, is a rename: show it the way `git diff -M` does.
 */
export function collapseFileMoves(diff: string): string {
    const blocks = splitIntoFileBlocks(diff);
    const movedOnly = (block: string, marker: RegExp): string | undefined => {
        const targets = bodyLines(block).map(line => marker.exec(line)?.[1]);
        return targets.length > 0 && targets.every(t => t !== undefined && t === targets[0]) ? targets[0] : undefined;
    };
    const renames = new Map<string, string>();
    for (const block of blocks) {
        const from = blockPath(block);
        const to = /\ndeleted file mode/.test(block) ? movedOnly(block, /^-\[\d+ lines? moved to ([^,\]]+)\]$/) : undefined;
        const target = to === undefined ? undefined : blocks.find(b => blockPath(b) === to);
        if (to !== undefined && target && /\nnew file mode/.test(target)
            && movedOnly(target, /^\+\[\d+ lines? moved from ([^,\]]+)\]$/) === from) {
            renames.set(from, to);
        }
    }
    const targets = new Set(renames.values());
    return blocks.flatMap(block => {
        const path = blockPath(block);
        if (targets.has(path)) {
            return [];
        }
        const to = renames.get(path);
        return to === undefined ? [block] : [`diff --git a/${path} b/${to}\nrename from ${path}\nrename to ${to}\n`];
    }).join('');
}
