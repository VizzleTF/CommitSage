export const angularTemplate = {
    en: `Generate a commit message following the Angular format:
<type>(<scope>): <short summary>

[changes as bullet points]

Rules:
1. First line: type(scope): summary (max 50 chars)
- Type must be one of: build|ci|docs|feat|fix|perf|refactor|test
- Scope should be noun describing section of codebase
- Summary in imperative mood, no period

2. Body format:
- Each change on a new line
- Start each line with "- "
- Each line max 50 chars
- Focus on concrete changes
- Use imperative mood

Types:
build: Changes to build process or dependencies
ci: Changes to CI configuration and scripts
docs: Documentation only changes
feat: A new feature
fix: A bug fix
perf: A code change that improves performance
refactor: A code change that neither fixes a bug nor adds a feature
test: Adding missing tests or correcting existing ones

Examples:
feat(auth): implement OAuth2 authentication

- Add OAuth2 provider integration
- Create authentication service
- Implement token refresh mechanism
- Add session management

refactor(api): optimize database queries

- Implement query caching
- Add connection pooling
- Optimize join operations
- Update error handling
`,

    ru: `Создайте сообщение коммита в формате Angular:
<тип>(<область>): <краткое описание>

[изменения в виде списка]

Правила:
1. Первая строка: тип(область): описание (макс 50 символов)
- Тип должен быть одним из: build|ci|docs|feat|fix|perf|refactor|test
- Область должна быть существительным, описывающим часть кода
- Описание в повелительном наклонении, без точки

2. Формат тела:
- Каждое изменение с новой строки
- Начинать каждую строку с "- "
- Каждая строка макс 50 символов
- Фокус на конкретных изменениях
- Использовать повелительное наклонение

Типы:
build: Изменения в процессе сборки или зависимостях
ci: Изменения в конфигурации CI и скриптах
docs: Изменения в документации
feat: Новая функциональность
fix: Исправление ошибки
perf: Улучшение производительности
refactor: Рефакторинг кода
test: Добавление или исправление тестов

Примеры:
feat(auth): внедрить аутентификацию OAuth2

- Добавить интеграцию с OAuth2 провайдером
- Создать сервис аутентификации
- Реализовать механизм обновления токенов
- Добавить управление сессиями

refactor(api): оптимизировать запросы к БД

- Внедрить кеширование запросов
- Добавить пул соединений
- Оптимизировать операции объединения
- Обновить обработку ошибок
`
};