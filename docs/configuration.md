# Configuration reference

Every Commit Sage setting lives under the `commitSage.*` namespace in VS Code settings. A project can override most of them in `.commitsage/config.json`.

## Settings priority

The extension resolves each key in this order; the first value found wins:

1. Project config: `.commitsage/config.json`.
2. VS Code workspace settings.
3. VS Code user (global) settings.
4. The default listed in the tables below.

Folder-scoped settings (`.vscode/settings.json` inside one root of a multi-root workspace) are not read.

## Provider

| Setting | Type | Default | Description |
|---|---|---|---|
| `commitSage.provider.type` | `string` | `"gemini"` | Provider that generates the message. One of `gemini`, `codestral`, `mistral`, `openai`, `ollama`, `openrouter`, `groq`, `anthropic`, `deepseek`, `xai`, `custom`. Setup per provider: [providers.md](providers.md). |

## General

| Setting | Type | Default | Description |
|---|---|---|---|
| `commitSage.general.temperature` | `number` | `0.7` | Sampling temperature for every provider. Range `0`–`2`. |
| `commitSage.general.maxDiffSize` | `number` | `100000` | Maximum diff size in characters sent to the model. A longer diff is truncated with a `...(truncated)` marker. `-1` disables truncation. Other values are clamped to `1000`–`1000000`. |
| `commitSage.general.maxOutputTokens` | `number` | `4096` | Maximum tokens the model may generate for one message, thinking tokens included. Minimum `1`. On truncation each retry doubles the budget (at most 3 times), capped at `32768`. |
| `commitSage.apiRequestTimeout` | `number` | `30` | Timeout for provider HTTP requests, in seconds. `-1` disables the timeout. |
| `commitSage.gitTimeout` | `number` | `120` | Timeout for `git` subprocesses (diff, blame, push), in seconds. Increase for slow pushes or large diffs. `-1` disables the timeout. |

## Commit

| Setting | Type | Default | Description |
|---|---|---|---|
| `commitSage.commit.commitLanguage` | `string` | `"english"` | Message language. One of `english`, `russian`, `chinese`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`, `custom`. For `custom`, see [custom-language.md](custom-language.md). |
| `commitSage.commit.customLanguageName` | `string` | `""` | Language name used when `commitLanguage` is `custom`, for example `Ukrainian`. |
| `commitSage.commit.commitFormat` | `string` | `"conventional"` | Message format. One of `conventional`, `angular`, `karma`, `semantic`, `emoji`, `emojiKarma`, `google`, `atom`, `detailed`, `previous`, `custom`. `previous` matches the style of recent commits. `custom`: with `useCustomInstructions` on, `customInstructions` is the whole prompt; otherwise the `conventional` template is used. Formats: [commit-formats.md](commit-formats.md). |
| `commitSage.commit.useCustomInstructions` | `boolean` | `false` | Uses `customInstructions` in place of the built-in template. `customInstructions` must not be empty. |
| `commitSage.commit.customInstructions` | `string` | `""` | Prompt text used when `useCustomInstructions` is `true`. |
| `commitSage.commit.useRecentCommitsAsContext` | `boolean` | `false` | Sends recent commit messages to the model as style examples. The selected format still sets the structure. |
| `commitSage.commit.recentCommitsCount` | `number` | `5` | Number of recent commits used as examples, with `useRecentCommitsAsContext` on or the `previous` format. Range `1`–`20`. Merge, version-bump, revert and WIP commits and messages under 10 characters are skipped. |
| `commitSage.commit.recentCommitsScope` | `string` | `"all"` | Whose commits are used as examples: `all` (any author) or `mine` (only yours). |
| `commitSage.commit.commitlint.enabled` | `boolean` | `false` | Validates the message against the rules of the selected format, fixes mechanical violations and retries with the model. Has no effect with the `custom` format. |
| `commitSage.commit.commitlint.maxRetries` | `number` | `3` | Maximum validation and refinement cycles. Range `1`–`10`. |
| `commitSage.commit.commitlint.rulesPath` | `string` | `""` | Path to a commitlint rules file, used by the `conventional` and `angular` formats. Empty: `commitlint.config.{js,cjs,json,yml,yaml}` in the repository root is used. |
| `commitSage.commit.commitlint.engine` | `string` | `"builtin"` | Validator. `builtin`: the bundled validator, runs no project code. `project`: the repository's commitlint CLI from `node_modules`, for `conventional`, `angular`, `atom`, `karma`, `semantic` and `google`; falls back to `builtin` when the CLI is unavailable. |
| `commitSage.commit.onlyStagedChanges` | `boolean` | `false` | `true`: only staged changes are analyzed. `false`: staged changes if any, otherwise all tracked changes. |
| `commitSage.commit.autoCommit` | `boolean` | `false` | Commits after the message is generated. |
| `commitSage.commit.autoPush` | `boolean` | `false` | Pushes after the auto-commit. Ignored unless `autoCommit` is `true`. |
| `commitSage.commit.refs.enabled` | `boolean` | `false` | Adds an issue or ticket ref, such as `#123` or `PROJ-456`, to every generated message. |
| `commitSage.commit.refs.source` | `string` | `"prompt"` | Where the ref comes from. `prompt`: asked before each generation. `branch`: extracted from the branch name with `branchPattern`. `input`: the fixed `refs.value`. |
| `commitSage.commit.refs.value` | `string` | `""` | Fixed ref used when `refs.source` is `input`. The settings panel buttons **Save for this branch**, **Save for project** and **Clear branch ref** manage it; a branch ref, kept in VS Code workspace state, wins over the project value. |
| `commitSage.commit.refs.placement` | `string` | `"end"` | Where the ref goes. `end`: own line after the message. `start`: own line before the message. `prefix`: start of the subject line. The ref is never placed in the subject scope. |
| `commitSage.commit.refs.branchPattern` | `string` | `"[A-Z][A-Z0-9]*-[0-9]+"` | Regular expression that extracts the ref from the branch name when `refs.source` is `branch`. The first capture group is used if present, otherwise the whole match. |

## Per provider

Each key applies only when `commitSage.provider.type` selects that provider.

| Setting | Type | Default | Description |
|---|---|---|---|
| `commitSage.gemini.model` | `string` | `"auto"` | Gemini model ID. `auto` tries the available models and prefers the best quality. |
| `commitSage.gemini.thinkingBudget` | `number` | `0` | Thinking token budget for Gemini 2.5 models. `0` disables thinking, `-1` lets the model decide, a positive number caps it. Minimum `-1`. Gemini 2.5 Pro raises `0` to `128`. Ignored by Gemini 3.x. |
| `commitSage.gemini.thinkingLevel` | `string` | `"low"` | Thinking depth for Gemini 3.x models. One of `minimal`, `low`, `medium`, `high`. Ignored by Gemini 2.5 and older. |
| `commitSage.codestral.model` | `string` | `"codestral-latest"` | Codestral model ID. |
| `commitSage.mistral.model` | `string` | `"mistral-small-latest"` | Mistral La Plateforme model ID. |
| `commitSage.openai.model` | `string` | `"gpt-3.5-turbo"` | OpenAI model ID. |
| `commitSage.openai.baseUrl` | `string` | `"https://api.openai.com/v1"` | OpenAI API base URL, for example an Azure OpenAI endpoint. |
| `commitSage.ollama.baseUrl` | `string` | `"http://localhost:11434"` | Ollama server URL. |
| `commitSage.ollama.model` | `string` | `"llama3.2"` | Ollama model name. The model must be installed on the server. |
| `commitSage.ollama.useAuthToken` | `boolean` | `false` | Sends the auth token set with `Set Ollama Auth Token`. |
| `commitSage.ollama.numCtx` | `number` | `0` | Context window passed to Ollama as `options.num_ctx`. `0` keeps the model's default. |
| `commitSage.openrouter.model` | `string` | `"meta-llama/llama-3.3-70b-instruct:free"` | OpenRouter model ID. |
| `commitSage.openrouter.preferFreeModels` | `boolean` | `false` | Limits the model picker to free models (`:free` suffix or zero pricing). |
| `commitSage.groq.model` | `string` | `"llama-3.3-70b-versatile"` | Groq model ID. |
| `commitSage.anthropic.model` | `string` | `"claude-sonnet-4-5-20250929"` | Anthropic model ID. |
| `commitSage.deepseek.model` | `string` | `"deepseek-chat"` | DeepSeek model ID. |
| `commitSage.xai.model` | `string` | `"grok-3-mini"` | xAI model ID. |
| `commitSage.custom.baseUrl` | `string` | `"http://localhost:1234/v1"` | Base URL of an OpenAI-compatible `chat/completions` endpoint. |
| `commitSage.custom.model` | `string` | `""` | Model ID sent to the custom endpoint. |
| `commitSage.custom.useApiKey` | `boolean` | `false` | Sends the key set with `Set Custom API Key`. |
| `commitSage.custom.chatCompletionsPath` | `string` | `"/chat/completions"` | Path appended to `custom.baseUrl` for chat requests. |

## Telemetry

| Setting | Type | Default | Description |
|---|---|---|---|
| `commitSage.telemetry.enabled` | `boolean` | `true` | Sends anonymous usage telemetry. Details: [telemetry.md](telemetry.md). |

## Commands

All commands are in the Command Palette under the `Commit Sage:` category. API keys and tokens are stored in VS Code secret storage, not in settings files.

| Command | Title |
|---|---|
| `commitsage.generateCommitMessage` | Generate Commit Message |
| `commitsage.createProjectConfig` | Create Project Config (.commitsage) |
| `commitsage.selectGeminiModel` | Select Gemini Model |
| `commitsage.loginOpenRouter` | Sign in to OpenRouter |
| `commitsage.setApiKey` / `commitsage.removeApiKey` | Set Gemini API Key / Remove Gemini API Key |
| `commitsage.setOpenAIApiKey` / `commitsage.removeOpenAIApiKey` | Set OpenAI API Key / Remove OpenAI API Key |
| `commitsage.setCodestralApiKey` / `commitsage.removeCodestralApiKey` | Set Codestral API Key / Remove Codestral API Key |
| `commitsage.setMistralApiKey` / `commitsage.removeMistralApiKey` | Set Mistral API Key / Remove Mistral API Key |
| `commitsage.setOllamaAuthToken` / `commitsage.removeOllamaAuthToken` | Set Ollama Auth Token / Remove Ollama Auth Token |
| `commitsage.setOpenRouterApiKey` / `commitsage.removeOpenRouterApiKey` | Set OpenRouter API Key / Remove OpenRouter API Key |
| `commitsage.setGroqApiKey` / `commitsage.removeGroqApiKey` | Set Groq API Key / Remove Groq API Key |
| `commitsage.setAnthropicApiKey` / `commitsage.removeAnthropicApiKey` | Set Anthropic API Key / Remove Anthropic API Key |
| `commitsage.setDeepSeekApiKey` / `commitsage.removeDeepSeekApiKey` | Set DeepSeek API Key / Remove DeepSeek API Key |
| `commitsage.setXaiApiKey` / `commitsage.removeXaiApiKey` | Set xAI API Key / Remove xAI API Key |
| `commitsage.setCustomApiKey` / `commitsage.removeCustomApiKey` | Set Custom API Key / Remove Custom API Key |

## Project config (`.commitsage/config.json`)

The project config holds the same keys as VS Code settings, without the `commitSage.` prefix and nested by section. Keys left out fall through to workspace and user settings. API keys are never read from this file.

- **Location.** `.commitsage/config.json` in the project root. `Create Project Config (.commitsage)` creates it in the first workspace folder. In a multi-root workspace the config and `translations.json` are read from the folder of the active editor, or from the first folder when no editor is open. Only the first folder is watched, migrated and used by `Create Project Config`.
- **Reload.** Changes to the file apply without reloading VS Code (first folder only in multi-root).
- **Invalid JSON.** The extension shows an error dialog and ignores the file. Fixes: [troubleshooting.md](troubleshooting.md).
- **Legacy file.** A single `.commitsage` JSON file is still read. On every startup, if the file holds valid JSON, the extension moves its content to `.commitsage/config.json`, unchanged. If the JSON is invalid, the file stays in place and is not migrated.
- **Custom language cache.** `.commitsage/translations.json` stores translated templates; see [custom-language.md](custom-language.md).

### Example

```json
{
  "provider": {
    "type": "ollama"
  },
  "commit": {
    "commitFormat": "emoji",
    "refs": {
      "enabled": true,
      "source": "branch"
    }
  },
  "ollama": {
    "model": "llama3.2"
  }
}
```

## Workspace trust

In an untrusted workspace, the project config cannot set these keys:

- `provider.type`
- `custom.baseUrl`, `custom.chatCompletionsPath`, `custom.useApiKey`
- `openai.baseUrl`
- `ollama.baseUrl`, `ollama.useAuthToken`
- `commit.autoCommit`, `commit.autoPush`
- `commit.commitlint.enabled`, `commit.commitlint.engine`, `commit.commitlint.rulesPath`

The extension logs a warning for each ignored key and uses the workspace or user value instead. VS Code also ignores workspace values of `commitSage.commit.autoCommit` and `commitSage.commit.autoPush`. Auto-commit and auto-push are skipped in an untrusted workspace whatever the settings say. Granting trust applies the ignored project values without a reload.
