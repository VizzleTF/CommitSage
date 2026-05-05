import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'tests/e2e/out/suite/**/*.e2e.js',
    version: 'stable',
    workspaceFolder: 'tests/e2e/sample.code-workspace',
    extensionDevelopmentPath: '.',
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
});
