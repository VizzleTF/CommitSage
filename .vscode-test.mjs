import { defineConfig } from '@vscode/test-cli';

const shared = {
    files: 'tests/e2e/out/suite/**/*.e2e.js',
    version: 'stable',
    workspaceFolder: 'tests/e2e/sample.code-workspace',
    launchArgs: [
        '--disable-extensions',
        '--disable-workspace-trust',
        '--disable-telemetry',
    ],
    mocha: {
        ui: 'bdd',
        timeout: 60_000,
        color: true,
        reporter: 'spec',
    },
    env: {
        COMMITSAGE_E2E: '1',
        NODE_ENV: 'test',
    },
};

export default defineConfig([
    // Dev bundle from `npm run compile`.
    { ...shared, label: 'dev', extensionDevelopmentPath: '.' },
    // The shipped artifact: production bundle unpacked from the .vsix, so
    // `.vscodeignore`, `main` and minification are exercised too. The suite is
    // copied inside the extension folder: VS Code hands each extension its own
    // `vscode` API object by file path, and sinon stubs on `vscode.window` only
    // reach the extension when the tests share its object.
    {
        ...shared,
        label: 'vsix',
        files: '.vscode-test/vsix/extension/e2e/suite/**/*.e2e.js',
        extensionDevelopmentPath: '.vscode-test/vsix/extension',
    },
]);
