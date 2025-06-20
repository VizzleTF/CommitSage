export const emojiKarmaTemplate = {
    english: `Generate a commit message following the Emoji-Karma format:
:emoji: type(scope): message

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation change
- style: Formatting, missing semi colons, etc
- refactor: Code refactoring
- test: Adding tests
- chore: Maintenance

Common emojis:
✨ :sparkles: - New feature
🐛 :bug: - Bug fix
📚 :books: - Documentation
💄 :lipstick: - UI/style changes
♻️ :recycle: - Refactoring
✅ :white_check_mark: - Tests
🔧 :wrench: - Configuration
⚡️ :zap: - Performance
🔒 :lock: - Security

Example:
✨ feat(auth): add user authentication system
🐛 fix(api): resolve token expiration issue`,

    russian: `Создайте сообщение коммита в формате Emoji-Karma:
:emoji: тип(область): сообщение

Типы:
- feat: Новая функциональность
- fix: Исправление ошибки
- docs: Изменения в документации
- style: Форматирование, пропущенные точки с запятой и т.д.
- refactor: Рефакторинг кода
- test: Добавление тестов
- chore: Обслуживание

Часто используемые эмодзи:
✨ :sparkles: - Новая функциональность
🐛 :bug: - Исправление ошибки
📚 :books: - Документация
💄 :lipstick: - Изменения UI/стиля
♻️ :recycle: - Рефакторинг
✅ :white_check_mark: - Тесты
🔧 :wrench: - Конфигурация
⚡️ :zap: - Производительность
🔒 :lock: - Безопасность

Пример:
✨ feat(auth): добавить систему аутентификации пользователей
🐛 fix(api): исправить проблему истечения срока токена`,

    chinese: `生成符合 Emoji-Karma 格式的提交信息：
:emoji: 类型(范围): 信息

类型：
- feat: 新功能
- fix: Bug 修复
- docs: 文档更改
- style: 格式化、缺少分号等
- refactor: 代码重构
- test: 添加测试
- chore: 维护

常用表情符号：
✨ :sparkles: - 新功能
🐛 :bug: - Bug 修复
📚 :books: - 文档
💄 :lipstick: - UI/样式变更
♻️ :recycle: - 重构
✅ :white_check_mark: - 测试
🔧 :wrench: - 配置
⚡️ :zap: - 性能
🔒 :lock: - 安全

示例：
✨ feat(auth): 添加用户认证系统
🐛 fix(api): 解决令牌过期问题`,

    japanese: `絵文字とKarma形式を組み合わせたコミットメッセージを生成してください：
:emoji: タイプ(スコープ): メッセージ

タイプ：
- feat: 新機能
- fix: バグ修正
- docs: ドキュメント変更
- style: フォーマット、セミコロンの欠落など
- refactor: コードリファクタリング
- test: テストの追加
- chore: メンテナンス

よく使用する絵文字：
✨ :sparkles: - 新機能
🐛 :bug: - バグ修正
📚 :books: - ドキュメント
💄 :lipstick: - UI/スタイル変更
♻️ :recycle: - リファクタリング
✅ :white_check_mark: - テスト
🔧 :wrench: - 設定
⚡️ :zap: - パフォーマンス
🔒 :lock: - セキュリティ

例：
✨ feat(auth): ユーザー認証システムを追加
🐛 fix(api): トークン期限切れの問題を解決`,

    spanish: `Genera un mensaje de commit siguiendo el formato Emoji-Karma:
:emoji: tipo(ámbito): mensaje

Tipos:
- feat: Nueva característica
- fix: Corrección de bug
- docs: Cambio en documentación
- style: Formato, punto y coma faltantes, etc
- refactor: Refactorización de código
- test: Añadir pruebas
- chore: Mantenimiento

Emojis comunes:
✨ :sparkles: - Nueva característica
🐛 :bug: - Corrección de bug
📚 :books: - Documentación
💄 :lipstick: - Cambios de UI/estilo
♻️ :recycle: - Refactorización
✅ :white_check_mark: - Pruebas
🔧 :wrench: - Configuración
⚡️ :zap: - Rendimiento
🔒 :lock: - Seguridad

Ejemplo:
✨ feat(auth): añadir sistema de autenticación de usuario
🐛 fix(api): resolver problema de expiración del token`
};