export const conventionalTemplate = {
    en: `Generate a commit message following the Conventional Commits format:
<type>[optional scope]: <description>

[body with changes as bullet points]

Rules:
1. First line: type(scope): description (max 50 chars)
- Type must be one of: feat|fix|docs|style|refactor|perf|test|build|ci|chore
- Scope is optional and should be area of the change
- Description should be clear and concise

2. Body format:
- Each change on a new line
- Start each line with "- "
- Each line max 50 chars
- Focus on what was changed
- Use imperative mood

Types guide:
feat: New feature or significant enhancement
fix: Bug fix
docs: Documentation changes
style: Code formatting/style only
refactor: Code change without behavior change
perf: Performance improvement
test: Adding/updating tests
build: Build system or dependencies
ci: CI/CD changes
chore: General maintenance

Examples:
feat(auth): add Google OAuth login

- Implement OAuth2 authentication flow
- Add user profile data fetching
- Create secure token storage
- Update login UI components

fix(api): resolve data caching issue

- Fix cache invalidation logic
- Add cache timeout checks
- Update error handling
`,

    ru: `Создайте сообщение коммита в формате Conventional Commits:
<тип>[область]: <описание>

[тело с изменениями как список]

Правила:
1. Первая строка: тип(область): описание (макс 50 символов)
- Тип должен быть одним из: feat|fix|docs|style|refactor|perf|test|build|ci|chore
- Область опциональна и должна указывать на место изменений
- Описание должно быть чётким и кратким

2. Формат тела:
- Каждое изменение с новой строки
- Начинать каждую строку с "- "
- Каждая строка макс 50 символов
- Фокус на том, что изменилось
- Использовать повелительное наклонение

Типы изменений:
feat: Новая функциональность
fix: Исправление ошибки
docs: Изменения в документации
style: Форматирование кода
refactor: Рефакторинг кода
perf: Улучшение производительности
test: Добавление/обновление тестов
build: Система сборки или зависимости
ci: Изменения в CI/CD
chore: Общие изменения

Примеры:
feat(auth): добавить вход через Google OAuth

- Реализовать поток аутентификации OAuth2
- Добавить получение данных профиля
- Создать безопасное хранение токенов
- Обновить компоненты UI входа

fix(api): исправить проблему с кешированием

- Исправить логику инвалидации кеша
- Добавить проверки таймаута кеша
- Обновить обработку ошибок
`
};