// Build script.
// Usage: node esbuild.js [--production] [--watch] [--analyze]

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const analyze = process.argv.includes('--analyze');

// Mirrors the problem-matcher format from
// https://code.visualstudio.com/api/working-with-extensions/bundling-extension
// so `npm run watch` errors land in VS Code's Problems pane.
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location == null) return;
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

const extensionBuildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // ESM entry points let esbuild tree-shake the Amplitude SDK (~130 KB less).
    mainFields: ['module', 'main'],
    // Keep non-ASCII prompt templates as UTF-8 instead of \uXXXX escapes.
    charset: 'utf8',
    external: ['vscode'],
    sourcemap: !production,
    sourcesContent: false,
    minify: production,
    logLevel: 'info',
    metafile: analyze,
    plugins: [esbuildProblemMatcherPlugin],
};

// Webview script ships to the browser-like webview frame; it must NOT pull in
// the Node `vscode` module. The webview talks to the extension only via
// `acquireVsCodeApi()` provided at runtime by the host.
const webviewBuildOptions = {
    entryPoints: ['src/views/webview/main.ts'],
    bundle: true,
    outfile: 'dist/webview/main.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    sourcemap: !production,
    sourcesContent: false,
    minify: production,
    logLevel: 'info',
    plugins: [esbuildProblemMatcherPlugin],
};

// Webview stylesheet, loaded by settingsWebviewProvider via asWebviewUri +
// <link>. Built separately so it's a real .css file in dist/webview rather
// than a string baked into the extension bundle.
const stylesBuildOptions = {
    entryPoints: ['src/views/webview/styles.css'],
    bundle: true,
    outfile: 'dist/webview/styles.css',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
    if (watch) {
        const [extCtx, webCtx, cssCtx] = await Promise.all([
            esbuild.context(extensionBuildOptions),
            esbuild.context(webviewBuildOptions),
            esbuild.context(stylesBuildOptions),
        ]);
        await Promise.all([extCtx.watch(), webCtx.watch(), cssCtx.watch()]);
        console.log('[esbuild] watching for changes…');
        return;
    }

    const [extResult] = await Promise.all([
        esbuild.build(extensionBuildOptions),
        esbuild.build(webviewBuildOptions),
        esbuild.build(stylesBuildOptions),
    ]);

    if (analyze && extResult.metafile) {
        const metaPath = path.join('dist', 'meta.json');
        fs.writeFileSync(metaPath, JSON.stringify(extResult.metafile));
        console.log(`[esbuild] metafile written to ${metaPath}`);
        console.log('[esbuild] analyze at https://esbuild.github.io/analyze/');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
