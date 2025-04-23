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

export const spanishShortInstructions = `Genera un mensaje de commit Git conciso basado en el diff proporcionado. Sigue estas reglas:
1. Usa el formato: <tipo>: <descripción>
2. Tipos:
- feat: para nuevas características o actualizaciones significativas
- fix: para correcciones de errores
- docs: para cambios en la documentación
- style: para formato, punto y coma faltantes, etc.
- refactor: para reestructuración de código sin cambiar su comportamiento
- test: para agregar o cambiar pruebas
- chore: para tareas pequeñas, mantenimiento o cambios triviales
- perf: para mejoras de rendimiento
- ci: para actualizaciones de pipeline CI/CD
- build: para cambios que afectan el sistema de compilación o dependencias
3. Mantén todo el mensaje en menos de 50 caracteres
4. Usa modo imperativo (ej., "Agrega" no "Agregado")
5. Enfócate en el cambio general, no en detalles específicos
6. No menciones nombres de archivos o números de línea

Ejemplos:
1. Diff: Agregada nueva función de autenticación de usuario
   Mensaje: feat: Agrega autenticación de usuario

2. Diff: Corregido error en procesamiento de pagos
   Mensaje: fix: Corrige procesamiento de pagos

3. Diff: Actualizado README con nuevos pasos de instalación
   Mensaje: docs: Actualiza instrucciones de instalación

4. Diff: Reformateado código según guía de estilo
   Mensaje: style: Aplica formato consistente de código

5. Diff: Reestructuradas consultas de base de datos para eficiencia
   Mensaje: refactor: Optimiza consultas de base de datos`;

export const spanishLongInstructions = `Crea un mensaje de commit Git detallado basado en el diff proporcionado. Sigue estas pautas:
1. Primera línea: <tipo>: <resumen breve> (50 caracteres o menos)
2. Tipos:
- feat: para nuevas características o actualizaciones significativas
- fix: para correcciones de errores
- docs: para cambios en la documentación
- style: para formato, punto y coma faltantes, etc.
- refactor: para reestructuración de código sin cambiar su comportamiento
- test: para agregar o cambiar pruebas
- chore: para tareas pequeñas, mantenimiento o cambios triviales
- perf: para mejoras de rendimiento
- ci: para actualizaciones de pipeline CI/CD
- build: para cambios que afectan el sistema de compilación o dependencias
3. Deja una línea en blanco después de la primera línea
4. Líneas siguientes: descripción detallada (ajustar a 72 caracteres)
5. Usa modo imperativo en todas las líneas
6. Explica qué y por qué, no cómo
7. Menciona cambios significativos y su impacto
8. No menciones nombres específicos de archivos o números de línea
9. Máximo 5 líneas en total (incluyendo línea en blanco)

Ejemplos:
1. Diff: Implementada funcionalidad de registro y login de usuario
   Mensaje: feat: Agrega sistema de autenticación de usuario

   Implementa procesos seguros de registro y login
   Integra verificación de correo para nuevas cuentas
   Mejora la seguridad general de la aplicación

2. Diff: Corregido error crítico causando pérdida de datos en respaldo
   Mensaje: fix: Resuelve problema de pérdida de datos en respaldo

   Identifica y corrige vulnerabilidad en rutina de respaldo
   Implementa verificaciones adicionales de integridad de datos
   Mejora manejo de errores y registro para respaldos

3. Diff: Actualizada documentación API con nuevos endpoints
   Mensaje: docs: Mejora documentación de API

   Agrega descripciones para endpoints API recién implementados
   Incluye ejemplos de uso y formatos de respuesta
   Actualiza sección de requisitos de autenticación

4. Diff: Refactorizado capa de acceso a base de datos para mejor rendimiento
   Mensaje: refactor: Optimiza operaciones de base de datos

   Implementa pool de conexiones para mejor eficiencia
   Reescribe consultas ineficientes usando indexación adecuada
   Agrega capa de caché para datos frecuentemente accedidos`;

export const customInstructions = "{customInstructions}";
