const path = require('path');
const webpack = require('webpack');
const Dotenv = require('dotenv-webpack');

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    return {
        target: 'node',
        entry: './src/extension.ts',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'extension.js',
            libraryTarget: 'commonjs2',
            devtoolModuleFilenameTemplate: '../[resource-path]',
            clean: true // Очистка dist папки при каждой сборке
        },
        // Настройка source maps в зависимости от режима
        devtool: isProduction ? false : 'source-map',

        resolve: {
            extensions: ['.ts', '.js'],
            // Приоритет для ES modules (лучше для tree-shaking)
            mainFields: ['module', 'main']
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
            vscode: 'commonjs vscode'
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