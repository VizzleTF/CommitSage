# GeminiCommit

<img alt="Visual Studio Marketplace Version" src="https://img.shields.io/visual-studio-marketplace/v/VizzleTF.geminicommit"> <img alt="Visual Studio Marketplace Last Updated" src="https://img.shields.io/visual-studio-marketplace/last-updated/VizzleTF.geminicommit"> <img alt="Visual Studio Marketplace Installs" src="https://img.shields.io/visual-studio-marketplace/i/VizzleTF.geminicommit"> <img alt="Visual Studio Marketplace Rating" src="https://img.shields.io/visual-studio-marketplace/stars/VizzleTF.geminicommit">

GeminiCommit is a VSCode extension that automatically generates commit messages using Google's Gemini AI or an OpenAI API endpoint (OpenAI, Ollama, LocalAI and others).

![GeminiCommit in action](example.gif)

[Features](#features) • [Quick Start & Usage](#quick-start--usage) • [Gemini Models & Custom Endpoints](#gemini-models--custom-endpoints) • [Example Messages](#example-messages)

## Features
- AI-powered commit message generation
- Support for Google's Gemini AI and custom endpoints (OpenAI API)
- Multi-language support (English and Russian, with more languages available upon request)
- Customizable message styles (short, long, custom)
- Option to include references (e.g., issue numbers)
- Secure API key storage

## Quick Start & Usage

1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit)
1. Set up API key:
   - For Gemini AI: Get key from [Google AI Studio](https://aistudio.google.com/app/apikey)
   - For custom endpoint: Configure in settings
1. Use Command Palette (Ctrl+Shift+P) to set API key
1. Configure preferences in VS Code settings
---
1. Stage your changes in Git
1. Click "Generate Commit Message" in Source Control view
1. (Optional) Enter references if prompted
1. Review and edit the generated message
1. Commit as usual

## Gemini Models & Custom Endpoints

Available free models:
- `gemini-1.0-pro`: Base model, good for general use
- `gemini-1.5-pro`: Enhanced version with better understanding
- `gemini-1.5-flash`: Optimized for speed (default)
- `gemini-2.0-flash-exp`: Experimental model with latest improvements
---
The extension supports OpenAI-compatible API endpoints. This allows you to:
- Use OpenAI API directly
- Use self-hosted LLMs with OpenAI-compatible API
- Connect to services like LocalAI, ollama, or other OpenAI API proxies

To configure a custom endpoint:
1. Enable "Use Custom Endpoint" in settings
2. Set your endpoint URL (e.g., "https://api.openai.com/v1" for OpenAI)
3. Set your model name (e.g., "gpt-3.5-turbo" for OpenAI)
4. Use Command Palette (Ctrl+Shift+P) to set API key

## Example Messages

Short format:
```
feat: add user authentication system
```

Long format:
```
feat(auth): implement user authentication system

- Add JWT token-based authentication
- Create login/register endpoints
- Implement password hashing
- Add session management
```

---

# GeminiCommit (на русском)

GeminiCommit - расширение VSCode для автоматической генерации сообщений коммитов с использованием Gemini AI от Google или OpenAI API (OpenAI, Ollama, LocalAI и другие).

### Быстрый старт & Использование

1. Установите из [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit)
1. Настройте API ключ:
   - Для Gemini AI: Получите ключ на [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Для пользовательского сервиса: Настройте в настройках
1. Используйте палитру команд (Ctrl+Shift+P) для установки API ключа
1. Настройте предпочтения в настройках VS Code
---
1. Подготовьте изменения в Git
1. Нажмите "Generate Commit Message" в панели Source Control
1. (Опционально) Введите ссылки, если запрошено
1. Просмотрите и отредактируйте сгенерированное сообщение
1. Сделайте коммит как обычно

### Модели & Эндпоинты

Доступные бесплатные модели:
- `gemini-1.0-pro`: Базовая модель, подходит для общего использования
- `gemini-1.5-pro`: Улучшенная версия с лучшим пониманием контекста
- `gemini-1.5-flash`: Оптимизирована для скорости (по умолчанию)
- `gemini-2.0-flash-exp`: Экспериментальная модель с последними улучшениями
---
Расширение поддерживает API-эндпоинты, совместимые с OpenAI. Это позволяет:
- Использовать OpenAI API напрямую
- Использовать self-hosted LLM с совместимым API
- Подключаться к сервисам LocalAI, ollama и другим прокси OpenAI API

Для настройки пользовательского эндпоинта:
1. Включите "Use Custom Endpoint" в настройках
2. Укажите URL эндпоинта (например, "https://api.openai.com/v1" для OpenAI)
3. Укажите название модели (например, "gpt-3.5-turbo" для OpenAI)
4. Используйте палитру команд (Ctrl+Shift+P) для установки API ключа

## Requirements & Support

- VS Code 1.93.0+
- Git
- Google AI API key or custom endpoint
---
- For issues, questions, or feature requests including additional language support, please use our [Telegram](https://t.me/+0qCa4b-tw703ZDRi) or [GitHub Issues](https://github.com/VizzleTF/GeminiCommit/issues) 
- Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.