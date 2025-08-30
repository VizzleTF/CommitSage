export const atomTemplate = {
    english: `Generate a commit message following the Atom format:
<type>(<scope>): <subject>

<body>

<footer>

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- style: Code style changes (formatting, missing semicolons, etc.)
- refactor: Code refactoring
- test: Adding or modifying tests
- chore: Maintenance tasks
- perf: Performance improvements
- ci: CI/CD changes
- build: Build system changes
- revert: Revert previous commit

Scope (optional): The part of the codebase affected (e.g., auth, ui, api, core)

Example:
feat(auth): add OAuth2 integration with Google provider

Implemented complete OAuth2 flow including:
- Authorization code exchange
- Token refresh mechanism
- User profile retrieval
- Session management

Tested with multiple user scenarios and edge cases.
Added comprehensive error handling for network failures.

Closes #123
Breaking-change: Updated auth API endpoints`,

    russian: `Создайте сообщение коммита в формате Atom:
<тип>(<область>): <тема>

<тело>

<подвал>

Типы:
- feat: Новая функциональность
- fix: Исправление ошибок
- docs: Изменения в документации
- style: Изменения стиля кода (форматирование, пропущенные точки с запятой и т.д.)
- refactor: Рефакторинг кода
- test: Добавление или изменение тестов
- chore: Вспомогательные задачи
- perf: Улучшения производительности
- ci: Изменения CI/CD
- build: Изменения системы сборки
- revert: Откат предыдущего коммита

Область (опционально): Часть кодовой базы, которая затронута (например, auth, ui, api, core)

Пример:
feat(auth): добавить интеграцию OAuth2 с провайдером Google

Реализован полный поток OAuth2, включающий:
- Обмен кода авторизации
- Механизм обновления токенов
- Получение профиля пользователя
- Управление сессиями

Протестировано с множественными пользовательскими сценариями и граничными случаями.
Добавлена комплексная обработка ошибок для сетевых сбоев.

Закрывает #123
Критическое изменение: Обновлены конечные точки API аутентификации`,

    chinese: `生成符合 Atom 格式的提交信息：
<类型>(<范围>): <主题>

<正文>

<页脚>

类型：
- feat: 新功能
- fix: Bug 修复
- docs: 文档更改
- style: 代码样式更改（格式化、缺少分号等）
- refactor: 代码重构
- test: 添加或修改测试
- chore: 维护任务
- perf: 性能改进
- ci: CI/CD 更改
- build: 构建系统更改
- revert: 撤销之前的提交

范围（可选）：受影响的代码库部分（例如：auth、ui、api、core）

示例：
feat(auth): 添加与 Google 提供商的 OAuth2 集成

实现了完整的 OAuth2 流程，包括：
- 授权码交换
- 令牌刷新机制
- 用户配置文件检索
- 会话管理

使用多种用户场景和边缘情况进行测试。
为网络故障添加了全面的错误处理。

关闭 #123
破坏性更改：更新了认证 API 端点`,

    japanese: `Atom形式のコミットメッセージを生成してください：
<タイプ>(<スコープ>): <件名>

<本文>

<フッター>

タイプ：
- feat: 新機能
- fix: バグ修正
- docs: ドキュメント変更
- style: コードスタイル変更（フォーマット、セミコロンの欠落など）
- refactor: コードリファクタリング
- test: テストの追加・修正
- chore: メンテナンスタスク
- perf: パフォーマンス改善
- ci: CI/CD変更
- build: ビルドシステム変更
- revert: 前のコミットを元に戻す

スコープ（オプション）：影響を受けるコードベースの部分（例：auth、ui、api、core）

例：
feat(auth): GoogleプロバイダーとのOAuth2統合を追加

以下を含む完全なOAuth2フローを実装：
- 認証コード交換
- トークンリフレッシュメカニズム
- ユーザープロファイル取得
- セッション管理

複数のユーザーシナリオとエッジケースでテスト済み。
ネットワーク障害に対する包括的なエラーハンドリングを追加。

#123を閉じる
破壊的変更：認証APIエンドポイントを更新`,

    spanish: `Genera un mensaje de commit siguiendo el formato Atom:
<tipo>(<ámbito>): <asunto>

<cuerpo>

<pie>

Tipos:
- feat: Nueva característica
- fix: Corrección de errores
- docs: Cambios en documentación
- style: Cambios de estilo de código (formato, punto y coma faltantes, etc.)
- refactor: Refactorización de código
- test: Añadir o modificar pruebas
- chore: Tareas de mantenimiento
- perf: Mejoras de rendimiento
- ci: Cambios de CI/CD
- build: Cambios del sistema de construcción
- revert: Revertir commit anterior

Ámbito (opcional): La parte del código base afectada (ej: auth, ui, api, core)

Ejemplo:
feat(auth): añadir integración OAuth2 con proveedor Google

Implementado flujo OAuth2 completo incluyendo:
- Intercambio de código de autorización
- Mecanismo de actualización de tokens
- Recuperación de perfil de usuario
- Gestión de sesiones

Probado con múltiples escenarios de usuario y casos límite.
Añadido manejo integral de errores para fallos de red.

Cierra #123
Cambio disruptivo: Actualizados endpoints de API de autenticación`
};