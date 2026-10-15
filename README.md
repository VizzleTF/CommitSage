# Commit Sage (formerly GeminiCommit)

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version/VizzleTF.geminicommit.svg)](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit) [![Visual Studio Marketplace Installs](https://vsmarketplacebadges.dev/installs/VizzleTF.geminicommit.svg)](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit) [![Visual Studio Marketplace Downloads](https://vsmarketplacebadges.dev/downloads/VizzleTF.geminicommit.svg)](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit) [![Visual Studio Marketplace Rating](https://vsmarketplacebadges.dev/rating-star/VizzleTF.geminicommit.svg)](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit) [![Ask DeepWiki](deepwiki.png)](https://deepwiki.com/VizzleTF/CommitSage)<br>
[![Open VSX Version](https://img.shields.io/open-vsx/v/VizzleTF/geminicommit?label=Open%20VSX)](https://open-vsx.org/extension/VizzleTF/geminicommit) [![Open VSX Downloads](https://img.shields.io/open-vsx/dt/VizzleTF/geminicommit?label=Open%20VSX%20downloads)](https://open-vsx.org/extension/VizzleTF/geminicommit) [![Open VSX Rating](https://img.shields.io/open-vsx/rating/VizzleTF/geminicommit?label=Open%20VSX%20rating)](https://open-vsx.org/extension/VizzleTF/geminicommit)<br>
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=VizzleTF_CommitSage&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=VizzleTF_CommitSage) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=VizzleTF_CommitSage&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=VizzleTF_CommitSage) [![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=VizzleTF_CommitSage&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=VizzleTF_CommitSage) [![CodeQL](https://github.com/VizzleTF/CommitSage/actions/workflows/codeql.yml/badge.svg)](https://github.com/VizzleTF/CommitSage/actions/workflows/codeql.yml)

Commit Sage is a VS Code extension that writes Git commit messages from your changes with an AI provider of your choice.

![Commit Sage in action](example.gif)

## Install

Requires VS Code 1.93.0 or later and Git. Cloud providers need internet access; Ollama and a self-hosted Custom endpoint do not.

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit), from [Open VSX](https://open-vsx.org/extension/VizzleTF/geminicommit), or from the command line:

```bash
code --install-extension VizzleTF.geminicommit
```

## Quick start

1. Open the **Commit Sage** view in the Activity Bar and pick a provider. The default is `gemini`.
2. In the same view, click the button to set the API key for that provider. The view links to the page where you get the key. Or run `Commit Sage: Set <PROVIDER> API Key` from the Command Palette.

   Ollama and Custom need no key by default.
3. Stage your changes and click the Commit Sage icon in the Source Control header, press `Ctrl+G` (`Cmd+G` on macOS) in the Source Control view, or run `Commit Sage: Generate Commit Message`.

The message appears in the Source Control input box. Review it and commit.

To steer the message, type a draft in the input box first, for example `fix login for SSO users`. The model keeps its intent and facts and rewrites it in the selected format. A message Commit Sage wrote is not taken as a draft: running it again sends that message as a rejected suggestion, and the model writes a different one. If generation fails or you cancel it, your draft stays in the box.

To turn a mixed change into several commits, run `Commit Sage: Split Changes into Commits` from the Source Control `...` menu. The model groups whole files into logical commits and writes a message for each; Commit Sage shows the plan and commits only after you confirm. A staged file that also has unstaged changes stops the split.

## Features

- 11 providers: Gemini, OpenRouter, Groq, Anthropic, OpenAI, DeepSeek, xAI, Codestral, Mistral, Ollama and Custom (any OpenAI-compatible endpoint). Setup per provider: [docs/providers.md](docs/providers.md).
- Commit formats: `conventional`, `angular`, `karma`, `semantic`, `emoji`, `emojiKarma`, `google`, `atom`, `detailed`, `previous` and `custom`. See [docs/commit-formats.md](docs/commit-formats.md).
- Message languages: English, Russian, Chinese, Japanese, Korean, German, French, Spanish, Portuguese, and `custom` ([docs/custom-language.md](docs/custom-language.md)).
- Commitlint validation with auto-fix and retries. It can read the repository's commitlint config; see [Commit settings](docs/configuration.md#commit).
- Optional auto-commit and auto-push, issue references, and custom instructions.
- Per-project settings in `.commitsage/config.json`, created with `Commit Sage: Create Project Config (.commitsage)`.
- In an untrusted workspace, Commit Sage ignores trust-sensitive keys in `.commitsage/config.json` and skips auto-commit. See [Workspace trust](docs/configuration.md#workspace-trust).

## Privacy

- API keys are stored in VS Code SecretStorage, not in settings or project files.
- Your diff and the draft in the Source Control input box are sent to the selected provider. Ollama and a self-hosted Custom endpoint keep them on your network.
- The free tier of Gemini, the default provider, may use what you send to improve Google products, and human reviewers may read it; in the EEA, Switzerland and the UK the paid-tier terms apply instead. OpenRouter free models and Mistral's free mode can also train on your data. Before using a free tier on private code, check [what each provider does with your data](docs/providers.md#data-use) and keep sensitive files out with the exclusions below.
- The content of `.env`, key and certificate files is never sent, only their path. Add your own patterns with `commitSage.general.excludeFiles` or a `.commitsageignore` file. Known secret formats in the rest of the diff (API keys, tokens, private keys) are masked. Masking is pattern-based, so prefer a local provider for a repository full of secrets. See [Sensitive files and secrets](docs/configuration.md#sensitive-files-and-secrets).
- Telemetry is on by default. Turn it off with `commitSage.telemetry.enabled: false`; details in [docs/telemetry.md](docs/telemetry.md).

## Documentation

- [Configuration](docs/configuration.md): every setting, its default, commands and project config
- [Providers](docs/providers.md): setup for each provider
- [Commit formats](docs/commit-formats.md)
- [Custom language](docs/custom-language.md)
- [Telemetry](docs/telemetry.md)
- [Troubleshooting](docs/troubleshooting.md)
- Contributors: [Adding a provider](docs/adding-providers.md), [Adding a language](docs/adding-languages.md), [Adding a format](docs/adding-formats.md), [Testing](docs/testing.md)

## Support and license

Report bugs and ideas in [GitHub issues](https://github.com/VizzleTF/CommitSage/issues). License: MIT.

---

# Commit Sage (на русском)

Commit Sage — расширение VS Code, которое пишет commit-сообщения по вашим изменениям через выбранного AI-провайдера.

## Установка

Нужны VS Code 1.93.0 или новее и Git. Облачным провайдерам нужен интернет; Ollama и self-hosted Custom работают без него. Установите расширение из [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VizzleTF.geminicommit), из [Open VSX](https://open-vsx.org/extension/VizzleTF/geminicommit) или командой:

```bash
code --install-extension VizzleTF.geminicommit
```

## Быстрый старт

1. Откройте панель **Commit Sage** в Activity Bar и выберите провайдера. По умолчанию — `gemini`.
2. Там же нажмите кнопку ввода API-ключа; панель даёт ссылку на страницу получения ключа. Или выполните `Commit Sage: Set <PROVIDER> API Key` из палитры команд.

   Ollama и Custom по умолчанию работают без ключа.
3. Добавьте изменения в индекс и нажмите иконку Commit Sage в заголовке Source Control, `Ctrl+G` (`Cmd+G` на macOS) в панели Source Control или выполните `Commit Sage: Generate Commit Message`.

Сообщение появится в поле ввода Source Control. Проверьте его и закоммитьте.

Чтобы направить модель, сначала напишите черновик в поле ввода, например `fix login for SSO users`. Модель сохранит его смысл и факты и перепишет в выбранном формате. Сообщение, которое написал сам Commit Sage, черновиком не считается: при повторном запуске оно уходит модели как отклонённый вариант, и она пишет другое. Если генерация завершилась ошибкой или вы её отменили, черновик остаётся в поле.

Чтобы разложить смешанные изменения на несколько коммитов, выполните `Commit Sage: Split Changes into Commits` из меню `...` панели Source Control. Модель группирует файлы целиком в логические коммиты и пишет сообщение для каждого; Commit Sage показывает план и коммитит только после подтверждения. Если у застейдженного файла есть и незастейдженные изменения, разбиение не запускается.

## Документация

Документация на английском: [настройки](docs/configuration.md), [провайдеры](docs/providers.md), [форматы](docs/commit-formats.md), [свой язык](docs/custom-language.md), [телеметрия](docs/telemetry.md), [решение проблем](docs/troubleshooting.md).

## Поддержка

- [Telegram-канал](https://t.me/geminicommit): анонсы обновлений
- [Telegram-группа](https://t.me/gemini_commit): обсуждения и поддержка

<a href="https://www.buymeacoffee.com/vizzletf" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="60" width="217"></a>
