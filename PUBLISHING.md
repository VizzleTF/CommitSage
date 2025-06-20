# Публикация расширения в VS Code Marketplace и Open VSX Registry

## Обзор

Workflow автоматически публикует расширение в два основных регистра:
- **VS Code Marketplace** (Microsoft)
- **Open VSX Registry** (Eclipse Foundation)

## Необходимые токены

### 1. VS Code Marketplace Token (`VS_MARKETPLACE_TOKEN`)

1. Перейдите на [Visual Studio Marketplace Publisher Management](https://marketplace.visualstudio.com/manage)
2. Войдите с аккаунтом Microsoft
3. Создайте Personal Access Token:
   - Скопируйте: Organization = `all accessible organizations`
   - Scopes: `Marketplace (manage)`
4. Добавьте токен в GitHub Secrets как `VS_MARKETPLACE_TOKEN`

### 2. Open VSX Registry Token (`OPEN_VSX_TOKEN`)

1. Перейдите на [Open VSX Registry](https://open-vsx.org/)
2. Войдите через GitHub
3. Перейдите в [User Settings](https://open-vsx.org/user-settings)
4. Создайте Access Token
5. Добавьте токен в GitHub Secrets как `OPEN_VSX_TOKEN`

## Как добавить GitHub Secrets

1. Перейдите в ваш репозиторий на GitHub
2. Settings → Secrets and variables → Actions
3. Нажмите "New repository secret"
4. Добавьте следующие секреты:
   - `VS_MARKETPLACE_TOKEN` - токен для VS Code Marketplace
   - `OPEN_VSX_TOKEN` - токен для Open VSX Registry
   - `AMPLITUDE_API_KEY` - (опционально) для телеметрии
   - `TELEGRAM_BOT_TOKEN` - (опционально) для уведомлений
   - `TELEGRAM_CHAT_ID` - (опционально) для уведомлений

## Процесс релиза

1. **Обновите версию** в `package.json`
2. **Создайте и пушните тег**:
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```
3. **Workflow автоматически**:
   - Соберет расширение
   - Создаст GitHub Release
   - Опубликует в VS Code Marketplace
   - Опубликует в Open VSX Registry
   - Отправит уведомление в Telegram

## Ссылки на опубликованное расширение

- **VS Code Marketplace**: https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit
- **Open VSX Registry**: https://open-vsx.org/extension/VizzleTF/geminicommit

## Устранение неполадок

### Ошибка публикации в Open VSX
- Убедитесь, что токен `OPEN_VSX_TOKEN` валидный
- Проверьте, что publisher name совпадает в обоих регистрах

### Ошибка публикации в VS Code Marketplace  
- Убедитесь, что токен `VS_MARKETPLACE_TOKEN` имеет права `Marketplace (manage)`
- Проверьте, что publisher `VizzleTF` существует и у вас есть к нему доступ

### Проверка статуса публикации
Workflow логи покажут статус каждого шага публикации. В случае ошибок проверьте:
- Валидность токенов
- Права доступа publisher
- Корректность версии в package.json 