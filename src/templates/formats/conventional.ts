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

Types:
feat: New feature
fix: Bug fix
docs: Documentation
style: Formatting
refactor: Code restructuring
perf: Performance
test: Testing
build: Build/dependencies
ci: CI/CD changes
chore: Maintenance

Examples:
Small change:
feat(api): add user profile endpoint

Complex change:
feat(auth): implement user authentication

- Add OAuth2 provider integration
- Create auth service module
- Add session storage`,

    ru: `Создайте сообщение коммита в формате Conventional Commits:
<тип>[область]: <описание>

[опциональное тело со списком изменений]

Правила:
1. Первая строка: тип(область): описание (макс 50 символов)
2. Для небольших изменений только первая строка
3. Для сложных изменений список ключевых моментов:
   - Каждая строка начинается с "- "
   - Каждая строка макс 50 символов

Типы:
feat: Новая функциональность
fix: Исправление ошибки
docs: Документация
style: Форматирование
refactor: Реструктуризация кода
perf: Производительность
test: Тестирование
build: Сборка/зависимости
ci: CI/CD изменения
chore: Обслуживание

Примеры:
Небольшое изменение:
feat(api): добавить эндпоинт профиля пользователя

Сложное изменение:
feat(auth): внедрить аутентификацию пользователей

- Добавить интеграцию с OAuth2
- Создать модуль сервиса авторизации
- Добавить хранение сессий`
};