# GeminiCommit

GeminiCommit is a VSCode extension that automatically generates commit messages using Google's Gemini AI or a custom AI endpoint.

![GeminiCommit in action](example.gif)

## Features

- AI-powered commit message generation
- Support for Google's Gemini AI and custom endpoints
- English and Russian language support
- Customizable message styles (short, long, custom)
- Option to include references (e.g., issue numbers)
- Secure API key storage

## Quick Start

1. Install from [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit)
2. Set up API key:
   - For Gemini AI: Get key from [Google AI Studio](https://aistudio.google.com/app/apikey)
   - For custom endpoint: Configure in settings
3. Use Command Palette (Ctrl+Shift+P) to set API key
4. Configure preferences in VS Code settings

## Usage

1. Stage your changes in Git
2. Click "Generate Commit Message" in Source Control view
3. (Optional) Enter references if prompted
4. Review and edit the generated message
5. Commit as usual

## Configuration

Access settings via File > Preferences > Settings, search for "GeminiCommit"

Key settings:
- `geminiCommit.useCustomEndpoint`: Enable custom endpoint
- `geminiCommit.commitLanguage`: Choose language (english/russian)
- `geminiCommit.commitMessageLength`: Set message style (short/long/custom)
- `geminiCommit.promptForRefs`: Enable reference prompting

## Requirements

- VS Code 1.93.0+
- Git
- Google AI API key or custom endpoint

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Support

For issues or questions, please use our [GitHub Issues](https://github.com/VizzleTF/GeminiCommit/issues).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

# GeminiCommit (на русском)

GeminiCommit - расширение VSCode для автоматической генерации сообщений коммитов с использованием Gemini AI от Google или пользовательского AI-сервиса.

## Быстрый старт

1. Установите из [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit)
2. Настройте API ключ:
   - Для Gemini AI: Получите ключ на [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Для пользовательского сервиса: Настройте в настройках
3. Используйте палитру команд (Ctrl+Shift+P) для установки API ключа
4. Настройте предпочтения в настройках VS Code

## Использование

1. Подготовьте изменения в Git
2. Нажмите "Generate Commit Message" в панели Source Control
3. (Опционально) Введите ссылки, если запрошено
4. Просмотрите и отредактируйте сгенерированное сообщение
5. Сделайте коммит как обычно

Полную документацию см. в английской версии выше.