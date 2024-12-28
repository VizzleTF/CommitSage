export const karmaTemplate = {
    en: `Generate a commit message following the Karma format:
<type>(<scope>): <message>

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation change
- style: Formatting, missing semi colons, etc
- refactor: Code refactoring
- test: Adding tests
- chore: Maintenance

Example:
chore(ci): update deployment script to Node 16`,

    ru: `Создайте сообщение коммита в формате Karma:
<тип>(<область>): <сообщение>

Типы:
- feat: Новая функциональность
- fix: Исправление ошибки
- docs: Изменения в документации
- style: Форматирование, пропущенные точки с запятой и т.д.
- refactor: Рефакторинг кода
- test: Добавление тестов
- chore: Обслуживание

Пример:
chore(ci): обновить скрипт деплоя до Node 16`
};