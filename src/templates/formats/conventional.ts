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
- Добавить управление сессиями`
};