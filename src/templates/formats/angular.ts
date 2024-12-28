export const angularTemplate = {
    en: `Generate a commit message following the Angular format:
<type>(<scope>): <short summary>

[optional body with bullet points]

Rules:
1. First line: type(scope): summary (max 50 chars)
2. For small changes use only first line
3. For complex changes list key points in body:
   - Each line starts with "- "
   - Each line max 50 chars

Types:
build: Build/dependencies
ci: CI configuration
docs: Documentation
feat: New feature
fix: Bug fix
perf: Performance
refactor: Code change
test: Testing

Examples:
Small change:
feat(api): add data validation method

Complex change:
refactor(core): optimize database queries

- Implement query caching
- Add connection pooling
- Update error handling`,

    ru: `Создайте сообщение коммита в формате Angular:
<тип>(<область>): <краткое описание>

[опциональное тело со списком изменений]

Правила:
1. Первая строка: тип(область): описание (макс 50 символов)
2. Для небольших изменений только первая строка
3. Для сложных изменений список ключевых моментов:
   - Каждая строка начинается с "- "
   - Каждая строка макс 50 символов

Типы:
build: Сборка/зависимости
ci: Конфигурация CI
docs: Документация
feat: Новая функция
fix: Исправление
perf: Производительность
refactor: Изменение кода
test: Тестирование

Примеры:
Небольшое изменение:
feat(api): добавить метод валидации данных

Сложное изменение:
refactor(core): оптимизировать запросы к БД

- Внедрить кеширование запросов
- Добавить пул соединений
- Обновить обработку ошибок`
};