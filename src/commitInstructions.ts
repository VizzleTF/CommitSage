export const englishShortInstructions = `Generate a concise Git commit message based on the provided diff. Follow these rules:
1. Use the format: <type>: <description>
2. Types:
- feat: for new features or significant updates
- fix: for bug fixes
- docs: for documentation changes
- style: for formatting, missing semi-colons, etc.
- refactor: for restructuring code without changing its behavior
- test: for adding or changing tests
- chore: for small tasks, maintenance, or trivial changes
- perf: for performance improvements
- ci: for CI/CD pipeline updates
- build: for changes that affect the build system or dependencies
3. Keep the entire message under 50 characters
4. Use imperative mood (e.g., "Add" not "Added")
5. Focus on the overall change, not specific details
6. Do not mention file names or line numbers

Few shot examples:
1. Diff: Added new user authentication feature
   Message: feat: Add user authentication

2. Diff: Fixed bug in payment processing
   Message: fix: Resolve payment processing issue

3. Diff: Updated README with new installation steps
   Message: docs: Update installation instructions

4. Diff: Reformatted code to follow style guide
   Message: style: Apply consistent code formatting

5. Diff: Restructured database queries for efficiency
   Message: refactor: Optimize database queries`;

export const englishLongInstructions = `Create a detailed Git commit message based on the provided diff. Follow these guidelines:
1. First line: <type>: <short summary> (50 chars or less)
2. Types:
- feat: for new features or significant updates
- fix: for bug fixes
- docs: for documentation changes
- style: for formatting, missing semi-colons, etc.
- refactor: for restructuring code without changing its behavior
- test: for adding or changing tests
- chore: for small tasks, maintenance, or trivial changes
- perf: for performance improvements
- ci: for CI/CD pipeline updates
- build: for changes that affect the build system or dependencies
3. Leave a blank line after the first line
4. Subsequent lines: detailed description (wrap at 72 chars)
5. Use imperative mood in all lines
6. Explain what and why, not how
7. Mention significant changes and their impact
8. Do not mention specific file names or line numbers
9. Maximum 5 lines total (including blank line)

Few shot examples:
1. Diff: Implemented user registration and login functionality
   Message: feat: Add user authentication system

   Implement secure user registration and login processes
   Integrate email verification for new accounts
   Enhance overall application security

2. Diff: Fixed critical bug causing data loss during backup
   Message: fix: Resolve data loss issue in backup process

   Identify and patch vulnerability in backup routine
   Implement additional data integrity checks
   Improve error handling and logging for backups

3. Diff: Updated API documentation with new endpoints
   Message: docs: Enhance API documentation

   Add descriptions for newly implemented API endpoints
   Include usage examples and response formats
   Update authentication requirements section

4. Diff: Refactored database access layer for better performance
   Message: refactor: Optimize database operations

   Implement connection pooling for improved efficiency
   Rewrite inefficient queries using proper indexing
   Add caching layer for frequently accessed data`;

export const russianShortInstructions = `Создайте краткое сообщение коммита Git на основе предоставленного diff. Следуйте этим правилам:
1. Используйте формат: <тип>: <описание>
2. Типы:
- feat: for new features or significant updates
- fix: for bug fixes
- docs: for documentation changes
- style: for formatting, missing semi-colons, etc.
- refactor: for restructuring code without changing its behavior
- test: for adding or changing tests
- chore: for small tasks, maintenance, or trivial changes
- perf: for performance improvements
- ci: for CI/CD pipeline updates
- build: for changes that affect the build system or dependencies
3. Ограничьте всё сообщение 50 символами
4. Используйте прошедшее время (например, "Добавил", а не "Добавить")
5. Сосредоточьтесь на общем изменении, а не на конкретных деталях
6. Не упоминайте имена файлов или номера строк

Примеры:
1. Diff: Добавлена новая функция аутентификации пользователей
   Сообщение: feat: Добавил аутентификацию пользователей

2. Diff: Исправлен баг в обработке платежей
   Сообщение: fix: Исправил обработку платежей

3. Diff: Обновлен README с новыми шагами установки
   Сообщение: docs: Обновил инструкции по установке

4. Diff: Отформатирован код в соответствии с руководством по стилю
   Сообщение: style: Применил единый стиль кода

5. Diff: Реструктурированы запросы к базе данных для эффективности
   Сообщение: refactor: Оптимизировал запросы к БД`;

export const russianLongInstructions = `Создайте подробное сообщение коммита Git на основе предоставленного diff. Следуйте этим указаниям:
1. Первая строка: <тип>: <краткое резюме> (не более 50 символов)
2. Типы:
- feat: for new features or significant updates
- fix: for bug fixes
- docs: for documentation changes
- style: for formatting, missing semi-colons, etc.
- refactor: for restructuring code without changing its behavior
- test: for adding or changing tests
- chore: for small tasks, maintenance, or trivial changes
- perf: for performance improvements
- ci: for CI/CD pipeline updates
- build: for changes that affect the build system or dependencies
3. Оставьте пустую строку после первой строки
4. Последующие строки: подробное описание (перенос на 72 символах)
5. Используйте прошедшее время во всех строках
6. Объясните что и почему, а не как
7. Упомяните значительные изменения и их влияние
8. Не упоминайте конкретные имена файлов или номера строк
9. Максимум 5 строк всего (включая пустую строку)

Примеры:
1. Diff: Реализована функциональность регистрации и входа пользователей
   Сообщение: feat: Добавил систему аутентификации пользователей

   Реализовал безопасные процессы регистрации и входа
   Интегрировал проверку электронной почты для новых аккаунтов
   Повысил общую безопасность приложения

2. Diff: Исправлен критический баг, вызывающий потерю данных при резервном копировании
   Сообщение: fix: Устранил проблему потери данных при резервировании

   Обнаружил и исправил уязвимость в процессе резервирования
   Внедрил дополнительные проверки целостности данных
   Улучшил обработку ошибок и логирование для резервных копий

3. Diff: Обновлена документация API с новыми эндпоинтами
   Сообщение: docs: Улучшил документацию API

   Добавил описания для недавно реализованных эндпоинтов API
   Включил примеры использования и форматы ответов
   Обновил раздел требований аутентификации

4. Diff: Рефакторинг уровня доступа к базе данных для улучшения производительности
   Сообщение: refactor: Оптимизировал операции с базой данных

   Реализовал пул соединений для повышения эффективности
   Переписал неэффективные запросы с использованием индексов
   Добавил уровень кэширования для часто запрашиваемых данных`;

export const customInstructions = "{customInstructions}";
