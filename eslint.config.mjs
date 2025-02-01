import eslint from '@eslint/js';
import * as tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';

export default [
    eslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: './tsconfig.json',
                ecmaVersion: 2020,
                sourceType: 'module'
            },
            globals: {
                console: 'readonly',
                setTimeout: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                Thenable: 'readonly'
            }
        },
        settings: {
            'import/resolver': {
                typescript: {
                    project: './tsconfig.json',
                    alwaysTryTypes: true
                },
                node: {
                    extensions: ['.ts', '.js'],
                    paths: ['node_modules', 'node_modules/@types']
                }
            }
        },
        plugins: {
            '@typescript-eslint': tseslint,
            'import': importPlugin,
            'unused-imports': unusedImportsPlugin
        },
        rules: {
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: 'default',
                    format: ['camelCase']
                },
                {
                    selector: 'variable',
                    format: ['camelCase', 'UPPER_CASE']
                },
                {
                    selector: 'parameter',
                    format: ['camelCase'],
                    leadingUnderscore: 'allow'
                },
                {
                    selector: 'memberLike',
                    modifiers: ['private'],
                    format: ['camelCase']
                },
                {
                    selector: 'typeLike',
                    format: ['PascalCase']
                },
                {
                    selector: ['objectLiteralProperty', 'objectLiteralMethod'],
                    filter: {
                        regex: '^(content-type|x-goog-api-key|Authorization)$',
                        match: true
                    },
                    format: null
                }
            ],
            'semi': ['error', 'always'],
            '@typescript-eslint/explicit-function-return-type': [
                'error',
                {
                    allowExpressions: true
                }
            ],
            'curly': ['error', 'all'],
            'eqeqeq': ['error', 'always'],
            'no-throw-literal': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_', // Ignore parameters starting with underscore
                    varsIgnorePattern: '^_',  // Ignore variables starting with underscore
                    ignoreRestSiblings: true
                }
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-floating-promises': 'error',
            'no-trailing-spaces': 'error',
            'no-multiple-empty-lines': ['error', { max: 1 }],
            'import/no-unresolved': 'error',
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_', // Ignore variables starting with underscore
                    args: 'after-used',
                    argsIgnorePattern: '^_', // Ignore parameters starting with underscore
                    ignoreRestSiblings: true
                }
            ]
        }
    }
];
