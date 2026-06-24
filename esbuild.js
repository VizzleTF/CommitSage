// Build script. Replaces webpack — see VSCODE_API_AUDIT.md (item 3).
// Usage: node esbuild.js [--production] [--watch] [--analyze]
//
// `process.env.AMPLITUDE_API_KEY` is replaced at build time:
//   - CI rewrites src/constants/apiKeys.ts with the literal value before
//     calling this, so the reference is gone by the time we bundle.
//   - Local devs may have a `.env` with AMPLITUDE_API_KEY=...; we load it
//     via dotenv and inject via esbuild's `define`. Missing => empty string,
//     which `telemetryService.initialize` short-circuits on.

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true });

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
    external: ['vscode'],
    sourcemap: !production,
    sourcesContent: false,
    minify: production,
    logLevel: 'info',
    metafile: analyze,
    plugins: [esbuildProblemMatcherPlugin],
    define: {
        'process.env.AMPLITUDE_API_KEY': JSON.stringify(process.env.AMPLITUDE_API_KEY ?? ''),
    },
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

    // Production builds emit no sourcemap; remove any leftover `.map` from a
    // prior dev build so it doesn't get bundled into the vsix.
    if (production) {
        for (const stale of [
            path.join('dist', 'extension.js.map'),
            path.join('dist', 'webview', 'main.js.map'),
            path.join('dist', 'webview', 'styles.css.map'),
        ]) {
            if (fs.existsSync(stale)) {
                fs.unlinkSync(stale);
            }
        }
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
