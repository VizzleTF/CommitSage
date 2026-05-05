import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['tests/e2e/**', 'node_modules/**'],
    },
    resolve: {
        alias: {
            vscode: resolve(__dirname, 'tests/__mocks__/vscode.ts'),
        },
    },
});
