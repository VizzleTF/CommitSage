# Commit Sage (formerly GeminiCommit)

<img alt="Visual Studio Marketplace Version" src="https://img.shields.io/visual-studio-marketplace/v/VizzleTF.geminicommit"> <img alt="Visual Studio Marketplace Last Updated" src="https://img.shields.io/visual-studio-marketplace/last-updated/VizzleTF.geminicommit"> <img alt="Visual Studio Marketplace Installs" src="https://img.shields.io/visual-studio-marketplace/i/VizzleTF.geminicommit"> <img alt="Visual Studio Marketplace Rating" src="https://img.shields.io/visual-studio-marketplace/stars/VizzleTF.geminicommit"> [![Ask DeepWiki](deepwiki.png)](https://deepwiki.com/VizzleTF/CommitSage)

Commit Sage is a VSCode extension that automatically generates commit messages using various AI providers:
- **Gemini** (default, requires API key, free tier)
- **OpenRouter** (300+ models behind one key, free-tier models available)
- **Groq** (fast inference, generous free tier)
- **Anthropic Claude** (requires API key)
- **OpenAI** (requires API key)
- **DeepSeek** (works without VPN in restricted regions)
- **xAI Grok** (requires API key)
- **Codestral** (requires API key, free tier)
- **Ollama** (local, free, no key)
- **Custom OpenAI-compatible** — LM Studio, vLLM, llama.cpp, LocalAI, Together AI, Fireworks, any self-hosted endpoint

![Commit Sage in action](example.gif)

## Features

- 🤖 AI-powered commit message generation
- 🔄 Auto model selection for Gemini (tries available models until success)
- 🌍 Multiple language support (English, Russian, Chinese, Japanese, Korean, German, French, Spanish, Portuguese)
- 📝 Various commit formats (Conventional, Angular, Karma, Semantic, Emoji, EmojiKarma, Google, Atom)
- 🔄 Smart handling of staged/unstaged changes
- 🚀 Auto-commit and auto-push capabilities
- 🎯 Custom instructions support
- ⚡ Fast and efficient processing

## Configuration

The fastest way is the **Commit Sage sidebar** (Activity Bar icon): pick a provider, paste an API key, and the model dropdown is populated live from each provider's `/models` endpoint.

Where to get keys:
- **Gemini** — [Google AI Studio](https://makersuite.google.com/app/apikey)
- **OpenRouter** — [openrouter.ai/keys](https://openrouter.ai/keys) (one key → 300+ models)
- **Groq** — [console.groq.com/keys](https://console.groq.com/keys)
- **Anthropic** — [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- **OpenAI** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **DeepSeek** — [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
- **xAI** — [console.x.ai](https://console.x.ai/)
- **Codestral** — [Mistral AI Console](https://console.mistral.ai/codestral)
- **Ollama** — no key needed (local)
- **Custom** — depends on your endpoint; key is optional

### AI Provider Settings

- **Provider Selection** (`commitSage.provider.type`):
  - Choose between: `gemini`, `openrouter`, `groq`, `anthropic`, `openai`, `deepseek`, `xai`, `codestral`, `ollama`, `custom`
  - Default: `gemini`

- **Gemini** — Model (`commitSage.gemini.model`): default `auto` (recommended). Auto mode fetches the live model list from the API and tries each sequentially until one succeeds — robust to model deprecations.

- **OpenRouter** — Model (`commitSage.openrouter.model`): default `meta-llama/llama-3.3-70b-instruct:free`. Toggle `commitSage.openrouter.preferFreeModels` to filter the model picker to free models only (default `true`).

- **Groq** — Model (`commitSage.groq.model`): default `llama-3.3-70b-versatile`. Free tier covers ~14 400 RPD on `llama-3.1-8b-instant`.

- **Anthropic** — Model (`commitSage.anthropic.model`): default `claude-sonnet-4-5-20250929`. Anthropic has no public `/models` endpoint, so the dropdown is a curated static list — see [docs/providers.md](docs/providers.md) for current options.

- **OpenAI** — Model (`commitSage.openai.model`) + Base URL (`commitSage.openai.baseUrl`, change only for Azure or another OpenAI-compatible deployment).

- **DeepSeek** — Model (`commitSage.deepseek.model`): default `deepseek-chat`.

- **xAI** — Model (`commitSage.xai.model`): default `grok-2-1212`.

- **Codestral** — Model (`commitSage.codestral.model`): default `codestral-latest`.

- **Ollama**:
  - Base URL (`commitSage.ollama.baseUrl`): default `http://localhost:11434`
  - Model (`commitSage.ollama.model`): default `llama3.2`
  - Auth token (`commitSage.ollama.useAuthToken`): off by default; enable for hosted Ollama instances behind auth.

- **Custom OpenAI-compatible**:
  - Base URL (`commitSage.custom.baseUrl`): e.g. `http://localhost:1234/v1` (LM Studio), `http://localhost:8000/v1` (vLLM), `https://api.together.xyz/v1`
  - Model (`commitSage.custom.model`): free-form ID your endpoint exposes
  - Send API key (`commitSage.custom.useApiKey`): off by default; enable for endpoints that require auth
  - Path (`commitSage.custom.chatCompletionsPath`): default `/chat/completions`

### Commit Settings

- **Language** (`commitSage.commit.commitLanguage`):
  - Options: `english`, `russian`, `chinese`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`
  - Default: `english`

- **Format** (`commitSage.commit.commitFormat`):
  - Options: `conventional`, `angular`, `karma`, `semantic`, `emoji`, `emojiKarma`, `google`, `atom`
  - Default: `conventional`

- **Staged Changes** (`commitSage.commit.onlyStagedChanges`):
  - When enabled: Only analyzes staged changes
  - When disabled: 
    - Uses staged changes if present
    - Uses all changes if no staged changes
  - Default: `false`

- **Auto Commit** (`commitSage.commit.autoCommit`):
  - Automatically commits after message generation
  - Default: `false`

- **Auto Push** (`commitSage.commit.autoPush`):
  - Automatically pushes after auto-commit
  - Requires Auto Commit to be enabled
  - Default: `false`

- **References** (`commitSage.commit.promptForRefs`):
  - Prompts for issue/PR references
  - Default: `false`

### Message Validation

- **Enable** (`commitSage.commit.commitlint.enabled`):
  - Validates the generated message against the rules of the selected commit format, auto-fixes mechanical violations (type/scope casing, trailing full stop, missing blank line) in code, and asks the LLM to rewrite when needed.
  - Every format has its own built-in rule set: conventional, angular, atom, karma, semantic, google, emoji, emojiKarma and detailed are all checked (emoji formats by header pattern, detailed by its Summary/Details/Effects structure).
  - Not available for the `custom` format — the checkbox switches off automatically when `custom` is selected.
  - The rules in force are also appended to the generation prompt, so the model sees exactly what the validator will check.
  - Default: `false`

- **Validator** (`commitSage.commit.commitlint.engine`):
  - `builtin` (default): the bundled static validator, no project code is executed. For `conventional`/`angular` it reads the repo's commitlint config when present (JSON, YAML, CJS, `package.json` field, local `extends`); other formats use their static rule sets.
  - `project`: the repo's **own commitlint CLI** from node_modules runs in a child process — exact parity with your CI: shareable presets (gitmoji, jira, lerna-scopes, …), `extends` chains, plugins and custom `parserPreset` work on any commitlint version. Applies to commitlint-compatible formats (conventional, angular, atom, karma, semantic, google); requires a trusted workspace; falls back to builtin when unavailable. The sidebar shows this choice only when commitlint is detected in the repo.

- **Max Retries** (`commitSage.commit.commitlint.maxRetries`):
  - Maximum number of validation + refinement cycles.
  - Range: 1–10. Default: `3`

- **Rules Path** (`commitSage.commit.commitlint.rulesPath`):
  - Custom path to the commitlint config file (e.g. `./config/commitlint.config.js`). Used by the `conventional` and `angular` formats.
  - Leave empty to auto-discover the `commitlint` field in `package.json` or `commitlint.config.{js,cjs,json,yml,yaml}` in the repository root.
  - Default: (empty — auto-discover)

### Custom Instructions

- **Enable** (`commitSage.commit.useCustomInstructions`):
  - Default: `false`

- **Instructions** (`commitSage.commit.customInstructions`):
  - Custom prompt instructions
  - Used when enabled

### Telemetry

- **Enable** (`commitSage.telemetry.enabled`):
  - Collects anonymous usage data
  - Default: `true`

## Project Configuration (.commitsage/config.json)

You can override extension settings for individual projects by creating a `.commitsage/config.json` file in your project root. This allows different projects to have different AI providers, commit formats, or other settings.

> Legacy single-file `.commitsage` configurations are still loaded and are automatically migrated to `.commitsage/config.json` on next activation.

### Creating Project Configuration

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run "Commit Sage: Create Project Config (.commitsage)"
3. Edit the generated `.commitsage/config.json` with your project-specific settings

### Example `.commitsage/config.json`:

```json
{
  "provider": {
    "type": "gemini"
  },
  "commit": {
    "commitLanguage": "russian",
    "commitFormat": "conventional",
    "autoCommit": false,
    "autoPush": false
  },
  "gemini": {
    "model": "auto"
  },
  "telemetry": {
    "enabled": false
  }
}
```

### Settings Priority

Settings are loaded in the following order (higher priority overrides lower):
1. **Project settings** (`.commitsage/config.json`) - Highest priority
2. **VS Code workspace settings** - Medium priority  
3. **VS Code global settings** - Lowest priority

### Notes

- The `.commitsage/config.json` file is automatically watched for changes
- Invalid JSON syntax will show an error notification
- API keys are still managed through VS Code's secure storage (not stored in project files)
- You can override any setting available in the extension configuration

## Usage

1. Stage your changes in Git
2. Open the Source Control view (Ctrl+Shift+G / Cmd+Shift+G), then press `Ctrl+G` (Windows/Linux) / `Cmd+G` (Mac) — the keybinding is scoped to the SCM view to avoid clashing with editor shortcuts
3. Or click the Commit Sage icon in the Source Control view
4. Or run "Commit Sage: Generate Commit Message" from the Command Palette (works from anywhere)
5. Wait for the AI to analyze changes and generate a message
6. Review and edit the message if needed
7. Commit as usual

## Requirements

- VSCode 1.93.0 or higher
- Git installed and configured
- Internet connection (except for Ollama and self-hosted Custom endpoints)
- API key for the selected cloud provider (none for Ollama, optional for Custom)

## Documentation

Detailed guides are available in the [`docs/`](docs/) directory:

- [Providers](docs/providers.md) — setup and comparison of all AI providers
- [Configuration Reference](docs/configuration.md) — all settings with defaults
- [Commit Formats](docs/commit-formats.md) — format descriptions and examples
- [Troubleshooting](docs/troubleshooting.md) — common errors and solutions
- [Adding a Provider](docs/adding-providers.md) — contributor guide
- [Adding a Language](docs/adding-languages.md) — contributor guide
- [Adding a Format](docs/adding-formats.md) — contributor guide
- [Testing](docs/testing.md) — running unit + E2E tests, mock LLM, adding new tests

## Privacy & Security

- **API keys** are stored in VS Code's secure storage (OS keychain), never in plain text files
- **Code changes** are sent to the selected AI provider for analysis — do not use cloud providers on repositories containing secrets
- **Ollama** runs locally — no data leaves your machine
- **Telemetry** collects anonymous usage events (provider type, errors) to help improve the extension; disable via `commitSage.telemetry.enabled: false`

## License

MIT

## Support

If you encounter any issues or have suggestions, please [open an issue](https://github.com/VizzleTF/CommitSage/issues).

For troubleshooting common problems, see [docs/troubleshooting.md](docs/troubleshooting.md).

---

# Commit Sage (на русском)

Commit Sage — расширение VSCode для автоматической генерации commit-сообщений через AI-провайдеров: Gemini, OpenRouter, Groq, Anthropic Claude, OpenAI, DeepSeek, xAI Grok, Codestral, локальный Ollama или любой OpenAI-совместимый endpoint (LM Studio, vLLM, llama.cpp, Together, Fireworks).

Для пользователей из РФ без VPN рабочие варианты: **DeepSeek**, **Ollama** локально, **Custom** (свой self-hosted endpoint).

## Установка

1. Установите из [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.commitsage)
2. Откройте sidebar **Commit Sage** (иконка в Activity Bar) — там выбор провайдера, ввод ключа и live-список моделей в одном окне
3. Альтернатива через палитру команд:
   - `Commit Sage: Set Gemini API Key`
   - `Commit Sage: Set OpenRouter API Key`
   - `Commit Sage: Set Groq API Key`
   - `Commit Sage: Set Anthropic API Key`
   - `Commit Sage: Set DeepSeek API Key`
   - `Commit Sage: Set xAI API Key`
   - `Commit Sage: Set OpenAI API Key`
   - `Commit Sage: Set Codestral API Key`
   - `Commit Sage: Set Ollama Auth Token`
   - `Commit Sage: Set Custom API Key`

Где получить ключи:
- Gemini → [Google AI Studio](https://makersuite.google.com/app/apikey)
- OpenRouter → [openrouter.ai/keys](https://openrouter.ai/keys)
- Groq → [console.groq.com/keys](https://console.groq.com/keys)
- Anthropic → [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- OpenAI → [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- DeepSeek → [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
- xAI → [console.x.ai](https://console.x.ai/)
- Codestral → [console.mistral.ai/codestral](https://console.mistral.ai/codestral)

## Использование

1. Добавьте изменения в Git (git add)
2. Откройте палитру команд (Ctrl+Shift+P / Cmd+Shift+P)
3. Введите "Commit Sage: Generate Commit Message"
4. Проверьте и подтвердите сгенерированное сообщение

## Настройка

Все настройки доступны через:
- Палитра команд → "Preferences: Open Settings (UI)"
- Поиск "Commit Sage"

## Конфигурация проекта (.commitsage/config.json)

Вы можете переопределить настройки расширения для отдельных проектов, создав файл `.commitsage/config.json` в корне проекта. Это позволяет разным проектам иметь разные провайдеры ИИ, форматы коммитов или другие настройки.

> Старый одиночный файл `.commitsage` всё ещё поддерживается и автоматически мигрируется в `.commitsage/config.json` при следующей активации расширения.

### Создание конфигурации проекта

1. Откройте палитру команд (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Выполните "Commit Sage: Create Project Config (.commitsage)"
3. Отредактируйте созданный `.commitsage/config.json` с настройками для вашего проекта

### Пример `.commitsage/config.json`:

```json
{
  "provider": {
    "type": "gemini"
  },
  "commit": {
    "commitLanguage": "russian",
    "commitFormat": "conventional",
    "autoCommit": false,
    "autoPush": false
  },
  "gemini": {
    "model": "auto"
  },
  "telemetry": {
    "enabled": false
  }
}
```

### Приоритет настроек

Настройки загружаются в следующем порядке (более высокий приоритет переопределяет низкий):
1. **Настройки проекта** (файл `.commitsage/config.json`) - Наивысший приоритет
2. **Настройки рабочей области VS Code** - Средний приоритет
3. **Глобальные настройки VS Code** - Низший приоритет

### Примечания

- Файл `.commitsage/config.json` автоматически отслеживается на изменения
- Неверный JSON синтаксис покажет уведомление об ошибке
- API ключи по-прежнему управляются через защищенное хранилище VS Code (не хранятся в файлах проекта)
- Вы можете переопределить любую настройку, доступную в конфигурации расширения

## Поддержка

- [Telegram Канал](https://t.me/geminicommit) - Анонсы обновлений
- [Telegram Группа](https://t.me/gemini_commit) - Обсуждения и поддержка сообщества
