const path = require('path');
const webpack = require('webpack');
const Dotenv = require('dotenv-webpack');

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    return {
        target: 'node', // Node.js для Git/FS операций, но с Web совместимостью
        entry: './src/extension.ts',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'extension.js',
            libraryTarget: 'commonjs2',
            devtoolModuleFilenameTemplate: '../[resource-path]',
            clean: true // Очистка dist папки при каждой сборке
        },
        // Настройка source maps в зависимости от режима
        devtool: isProduction ? 'hidden-source-map' : 'source-map',

        resolve: {
            extensions: ['.ts', '.js'],
            // VS Code Web compatibility - приоритет browser entry points
            mainFields: ['browser', 'module', 'main'],
            // Webpack 5 fallbacks for Node.js modules
            fallback: {
                // Add polyfills for Node.js core modules if needed
                "fs": false,
                "os": false,
                "path": false,
                "crypto": false,
                "stream": false,
                "buffer": false,
                "child_process": false,
                "http": false,
                "https": false,
                "url": false,
                "util": false,
                "events": false
            },
            alias: {
                // Optimize imports with aliases
                '@': path.resolve(__dirname, 'src'),
                '@services': path.resolve(__dirname, 'src/services'),
                '@utils': path.resolve(__dirname, 'src/utils'),
                '@models': path.resolve(__dirname, 'src/models')
            }
        },

        module: {
            rules: [
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: 'ts-loader',
                            options: {
                                // Ускорение компиляции в development
                                transpileOnly: !isProduction
                            }
                        }
                    ]
                }
            ]
        },

        externals: {
            vscode: 'commonjs vscode' // Only vscode module is external
            // Bundle runtime dependencies: @amplitude/analytics-node, axios
        },

        // Основные оптимизации
        optimization: {
            // Минификация только в production
            minimize: isProduction,
            minimizer: isProduction ? [
                new (require('terser-webpack-plugin'))({
                    terserOptions: {
                        compress: {
                            drop_console: true, // Удаляем console.log в production
                            drop_debugger: true,
                            pure_funcs: ['console.log'] // Удаляем специфичные функции
                        },
                        mangle: {
                            // Сохраняем имена классов для лучшей отладки
                            keep_classnames: false,
                            keep_fnames: false
                        },
                        format: {
                            comments: false // Удаляем комментарии
                        }
                    },
                    extractComments: false
                })
            ] : [],

            // Tree-shaking конфигурация
            usedExports: true,
            sideEffects: false, // Указываем что наш код не имеет побочных эффектов

            // Модульная конкатенация для лучшего tree-shaking
            concatenateModules: isProduction,

            // Детерминистические IDs для лучшего кэширования
            moduleIds: 'deterministic',
            chunkIds: 'deterministic',

            // Для VS Code расширений используем один файл
            splitChunks: false
        },

        plugins: [
            new Dotenv({
                systemvars: true, // Использовать системные переменные
                silent: true // Не показывать ошибки если .env не найден
            }),

            // Плагин для анализа размера бандла (включается через переменную окружения)
            ...(process.env.ANALYZE ? [
                new (require('webpack-bundle-analyzer')).BundleAnalyzerPlugin({
                    analyzerMode: 'static',
                    openAnalyzer: false,
                    reportFilename: 'bundle-analysis.html'
                })
            ] : []),

            // Показывать прогресс сборки
            new webpack.ProgressPlugin(),

            // Определение переменных среды
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development')
            })
        ],

        // Настройки производительности
        performance: {
            hints: isProduction ? 'warning' : false,
            maxEntrypointSize: 500000, // 500KB предупреждение
            maxAssetSize: 500000
        },

        // Кэширование для ускорения повторных сборок
        cache: {
            type: 'filesystem',
            buildDependencies: {
                config: [__filename]
            }
        },

        // Статистика вывода
        stats: {
            all: false,
            modules: true,
            errors: true,
            warnings: true,
            moduleTrace: true,
            errorDetails: true
        }
    };
}; 