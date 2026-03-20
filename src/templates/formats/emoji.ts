export const emojiTemplate = {
    english: `Generate a commit message following the Emoji format:
:emoji: commit message

Common emojis (Gitmoji + Conventional Emoji Commits):
✨ :sparkles: - New feature
🐛 :bug: - Bug fix
📝 :memo: - Documentation updates
🎨 :art: - Code style/formatting changes
♻️ :recycle: - Refactoring without functionality changes
🧪 :test_tube: - Adding or changing tests
🛠️ :hammer_and_wrench: - Build/tools/dependencies
🤖 :robot: - CI/CD configuration
⚡️ :zap: - Performance optimization
🔧 :wrench: - Maintenance/chores
🔒 :lock: - Security fixes
🚀 :rocket: - Release/deployment
🔥 :fire: - Remove code or files
⬆️ :arrow_up: - Upgrade dependencies
⬇️ :arrow_down: - Downgrade dependencies
✅ :white_check_mark: - Fix CI build

Example:
✨ add real-time collaboration feature
🐛 fix authentication token expiration`,

    russian: `Создайте сообщение коммита в формате Emoji:
:emoji: сообщение коммита

Часто используемые эмодзи (Gitmoji + Conventional Emoji Commits):
✨ :sparkles: - Новая функциональность
🐛 :bug: - Исправление ошибок
📝 :memo: - Обновление документации
🎨 :art: - Изменения оформления/стиля кода
♻️ :recycle: - Рефакторинг без изменений функциональности
🧪 :test_tube: - Добавление или изменение тестов
🛠️ :hammer_and_wrench: - Сборка/инструменты/зависимости
🤖 :robot: - Настройка CI/CD процессов
⚡️ :zap: - Оптимизация производительности
🔧 :wrench: - Вспомогательные изменения
🔒 :lock: - Исправление уязвимостей безопасности
🚀 :rocket: - Релиз/деплой
🔥 :fire: - Удаление кода или файлов
⬆️ :arrow_up: - Обновление зависимостей
⬇️ :arrow_down: - Понижение версий зависимостей
✅ :white_check_mark: - Исправление сборки CI

Пример:
✨ добавить функцию совместной работы в реальном времени
🐛 исправить срок действия токена аутентификации`,

    chinese: `生成符合 Emoji 格式的提交信息：
:emoji: 提交信息

常用表情符号 (Gitmoji + Conventional Emoji Commits)：
✨ :sparkles: - 新功能
🐛 :bug: - Bug 修复
📝 :memo: - 文档更新
🎨 :art: - 代码样式/格式变更
♻️ :recycle: - 重构（不改变功能）
🧪 :test_tube: - 添加或修改测试
🛠️ :hammer_and_wrench: - 构建/工具/依赖
🤖 :robot: - CI/CD 配置
⚡️ :zap: - 性能优化
🔧 :wrench: - 维护/杂项
🔒 :lock: - 安全修复
🚀 :rocket: - 发布/部署
🔥 :fire: - 删除代码或文件
⬆️ :arrow_up: - 升级依赖
⬇️ :arrow_down: - 降级依赖
✅ :white_check_mark: - 修复CI构建

示例：
✨ 添加实时协作功能
🐛 修复认证令牌过期问题`,

    japanese: `絵文字形式のコミットメッセージを生成してください：
:emoji: コミットメッセージ

よく使用する絵文字 (Gitmoji + Conventional Emoji Commits)：
✨ :sparkles: - 新機能
🐛 :bug: - バグ修正
📝 :memo: - ドキュメント更新
🎨 :art: - コードスタイル/フォーマット変更
♻️ :recycle: - 機能変更なしのリファクタリング
🧪 :test_tube: - テストの追加・変更
🛠️ :hammer_and_wrench: - ビルド/ツール/依存関係
🤖 :robot: - CI/CD設定
⚡️ :zap: - パフォーマンス最適化
🔧 :wrench: - メンテナンス/雑務
🔒 :lock: - セキュリティ修正
🚀 :rocket: - リリース/デプロイ
🔥 :fire: - コードやファイルの削除
⬆️ :arrow_up: - 依存関係アップグレード
⬇️ :arrow_down: - 依存関係ダウングレード
✅ :white_check_mark: - CIビルド修正

例：
✨ リアルタイムコラボレーション機能を追加
🐛 認証トークンの有効期限の問題を修正`,

    spanish: `Genera un mensaje de commit siguiendo el formato Emoji:
:emoji: mensaje de commit

Emojis comunes (Gitmoji + Conventional Emoji Commits):
✨ :sparkles: - Nueva característica
🐛 :bug: - Corrección de errores
📝 :memo: - Actualización de documentación
🎨 :art: - Cambios de estilo/formato de código
♻️ :recycle: - Refactorización sin cambios de funcionalidad
🧪 :test_tube: - Añadir o cambiar pruebas
🛠️ :hammer_and_wrench: - Build/herramientas/dependencias
🤖 :robot: - Configuración CI/CD
⚡️ :zap: - Optimización de rendimiento
🔧 :wrench: - Cambios auxiliares/mantenimiento
🔒 :lock: - Corrección de vulnerabilidades de seguridad
🚀 :rocket: - Release/despliegue
🔥 :fire: - Eliminar código o archivos
⬆️ :arrow_up: - Actualizar dependencias
⬇️ :arrow_down: - Degradar dependencias
✅ :white_check_mark: - Arreglar build CI

Ejemplo:
✨ añadir característica de colaboración en tiempo real
🐛 corregir expiración del token de autenticación`,

    portuguese: `Gere uma mensagem de commit seguindo o formato Emoji:
:emoji: mensagem de commit

Emojis comuns (Gitmoji + Conventional Emoji Commits):
✨ :sparkles: - Nova funcionalidade
🐛 :bug: - Correção de bug
📝 :memo: - Atualizações de documentação
🎨 :art: - Mudanças de estilo/formatação de código
♻️ :recycle: - Refatoração sem mudanças de funcionalidade
🧪 :test_tube: - Adição ou alteração de testes
🛠️ :hammer_and_wrench: - Build/ferramentas/dependências
🤖 :robot: - Configuração de CI/CD
⚡️ :zap: - Otimização de desempenho
🔧 :wrench: - Manutenção/tarefas genéricas
🔒 :lock: - Correções de segurança
🚀 :rocket: - Release/implantação
🔥 :fire: - Remover código ou arquivos
⬆️ :arrow_up: - Atualizar dependências
⬇️ :arrow_down: - Reverter atualização de dependências
✅ :white_check_mark: - Corrigir build do CI

Exemplo:
✨ adicionar funcionalidade de colaboração em tempo real
🐛 corrigir expiração do token de autenticação`,
};