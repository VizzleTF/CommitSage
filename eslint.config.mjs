import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
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
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
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
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                    ignoreRestSiblings: true
                }
            ]
        }
    }
);
