import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['tests/e2e/**', 'node_modules/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            reportsDirectory: 'coverage',
            include: ['src/**/*.ts'],
            // Keep in sync with sonar.coverage.exclusions in
            // sonar-project.properties — VS Code glue covered by e2e, not unit.
            exclude: [
                'src/**/*.d.ts',
                'src/constants/apiKeys.ts',
                'src/models/types.ts',
                'src/views/webview/**',
                'src/extension.ts',
                'src/views/settingsWebviewProvider.ts',
                'src/services/aiService.ts',
                'src/services/commitWorkflow.ts',
                'src/commands/**',
            ],
        },
    },
    resolve: {
        alias: {
            vscode: resolve(__dirname, 'tests/__mocks__/vscode.ts'),
        },
    },
});
