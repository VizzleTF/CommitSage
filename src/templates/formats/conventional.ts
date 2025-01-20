export const conventionalTemplate = {
    en: `Generate a commit message following the Conventional Commits format:
<type>[optional scope]: <description>

[optional body with bullet points]

Rules:
1. First line: type(scope): description (max 50 chars)
2. For small changes use only first line
3. For complex changes list key points in body:
   - Each line starts with "- "
   - Each line max 50 chars

Type selection rules:
- docs: ANY changes to documentation files (*.md, docs/*)
- feat: New features or significant functional changes
- fix: Bug fixes and error corrections
- style: Formatting, semicolons, etc (no code change)
- refactor: Code changes that don't fix bugs or add features
- perf: Performance improvements
- test: Adding or updating tests
- build: Build system or dependencies
- ci: CI/CD changes
- chore: Other maintenance tasks

Examples:
Documentation change:
docs: update installation and usage guides

- Add new features description
- Update configuration section
- Add usage examples

Feature change:
feat(auth): add user authentication

- Implement OAuth2 provider integration
- Create auth service module
- Add session management`,

    ru: `Создайте сообщение коммита в формате Conventional Commits:
<тип>[область]: <описание>

[опциональное тело со списком изменений]

Правила:
1. Первая строка: тип(область): описание (макс 50 символов)
2. Для небольших изменений только первая строка
3. Для сложных изменений список ключевых моментов:
   - Каждая строка начинается с "- "
   - Каждая строка макс 50 символов

Правила выбора типа:
- docs: ЛЮБЫЕ изменения в документации (*.md, docs/*)
- feat: Новая функциональность или значимые изменения
- fix: Исправление ошибок
- style: Форматирование, точки с запятой и т.д.
- refactor: Изменения кода без новой функциональности
- perf: Улучшения производительности
- test: Добавление или обновление тестов
- build: Система сборки или зависимости
- ci: Изменения в CI/CD
- chore: Другие задачи обслуживания

Примеры:
Изменение документации:
docs: обновить руководство по установке и использованию

- Добавить описание новых функций
- Обновить раздел конфигурации
- Добавить примеры использования

Новая функциональность:
feat(auth): добавить аутентификацию пользователей

- Внедрить интеграцию с OAuth2
- Создать модуль сервиса авторизации
- Добавить управление сессиями`,

    cn: `生成符合约定式提交（Conventional Commits）格式的提交信息：
<类型>[可选范围]: <描述>

[可选正文，包含要点]

规则：

第一行：类型(范围): 描述（最多50个字符）
对于小改动，仅使用第一行
对于复杂改动，在正文中列出关键点：
每行以“- ”开头
每行最多50个字符
类型选择规则：

docs: 对文档文件的任何修改（.md, docs/）
feat: 新功能或重要的功能变更
fix: Bug修复和错误更正
style: 格式修改，如分号等（无代码变动）
refactor: 不修复bug或添加功能的代码修改
perf: 性能提升
test: 添加或更新测试
build: 构建系统或依赖项的变动
ci: CI/CD的变动
chore: 其他维护任务
示例：
文档修改：
docs: 更新安装和使用指南

添加新功能描述
更新配置部分
增加使用示例
功能更改：
feat(auth): 添加用户认证

实现OAuth2提供者集成
创建身份验证服务模块
添加会话管理
`
};