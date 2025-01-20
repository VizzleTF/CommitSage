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
- Обновить обработку ошибок`,

    cn: `生成符合 Angular 格式的提交信息：
<类型>(<范围>): <简短概述>

[可选正文，包含要点]

规则：

第一行：类型(范围): 概述（最多50个字符）
对于小改动，仅使用第一行
对于复杂改动，在正文中列出关键点：
每行以“- ”开头
每行最多50个字符
类型：
build: 构建/依赖项
ci: CI 配置
docs: 文档
feat: 新功能
fix: Bug 修复
perf: 性能
refactor: 代码重构
test: 测试

示例：
小改动：
feat(api): 添加数据验证方法

复杂改动：
refactor(core): 优化数据库查询

实现查询缓存
添加连接池
更新错误处理`
};