# Configuration Reference

All settings are under the `commitSage.*` namespace in VS Code settings.

---

## Settings Priority

Settings are resolved in the following order (higher priority wins):

1. **Project settings** (`.commitsage` file) — highest priority
2. **VS Code workspace settings** — medium priority
3. **VS Code global (user) settings** — lowest priority

---

## Provider Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commitSage.provider.type` | `string` | `"gemini"` | AI provider: `gemini`, `openai`, `codestral`, `ollama` |

### Gemini

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commitSage.gemini.model` | `string` | `"auto"` | Model name or `auto` for automatic selection |

### OpenAI

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commitSage.openai.model` | `string` | `"gpt-3.5-turbo"` | Model name |
| `commitSage.openai.baseUrl` | `string` | `"https://api.openai.com/v1"` | API base URL (for custom endpoints) |

### Codestral

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commitSage.codestral.model` | `string` | `"codestral-latest"` | `codestral-2405` or `codestral-latest` |

### Ollama

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commitSage.ollama.baseUrl` | `string` | `"http://localhost:11434"` | Ollama server URL |
| `commitSage.ollama.model` | `string` | `"llama3.2"` | Model name |
| `commitSage.ollama.useAuthToken` | `boolean` | `false` | Enable if Ollama requires authentication |

---

## Commit Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commitSage.commit.commitLanguage` | `string` | `"english"` | Language for generated messages: `english`, `russian`, `chinese`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`, `custom` |
| `commitSage.commit.customLanguageName` | `string` | `""` | Language name used when `commitLanguage` is `custom` (e.g. `"Ukrainian"`, `"Italian"`). The format template is translated by the LLM and cached in `.commitsage/translations.json`. See [custom-language.md](custom-language.md) |
| `commitSage.commit.commitFormat` | `string` | `"conventional"` | Commit format: `conventional`, `angular`, `karma`, `semantic`, `emoji`, `emojiKarma`, `google`, `atom` |
| `commitSage.commit.onlyStagedChanges` | `boolean` | `false` | When `true`, only analyzes staged changes. When `false`, uses staged if present, otherwise all changes |
| `commitSage.commit.autoCommit` | `boolean` | `false` | Automatically commit after message generation |
| `commitSage.commit.autoPush` | `boolean` | `false` | Automatically push after auto-commit (requires `autoCommit` enabled) |
| `commitSage.commit.promptForRefs` | `boolean` | `false` | Prompt for issue/PR references before generating |
| `commitSage.commit.useCustomInstructions` | `boolean` | `false` | Use custom prompt instead of built-in templates |
| `commitSage.commit.customInstructions` | `string` | `""` | Custom prompt text (used when `useCustomInstructions` is `true`) |

---

## Other Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commitSage.apiRequestTimeout` | `number` | `30` | API request timeout in seconds (`-1` for no timeout) |
| `commitSage.telemetry.enabled` | `boolean` | `true` | Enable anonymous usage telemetry |

---

## Project Configuration (`.commitsage`)

CommitSage supports two layouts for project-level configuration:

| Layout | When used |
|--------|-----------|
| `.commitsage` (single JSON file) | Legacy; still supported |
| `.commitsage/config.json` (directory) | Used when custom language cache is active |

Both are read automatically. If you use the [custom language](custom-language.md) feature, `.commitsage` is migrated to a directory transparently.

**Create via Command Palette:** "Commit Sage: Create Project Configuration (.commitsage)"

### Full Example

```json
{
  "provider": {
    "type": "gemini"
  },
  "commit": {
    "commitLanguage": "english",
    "customLanguageName": "",
    "commitFormat": "conventional",
    "useCustomInstructions": false,
    "customInstructions": "",
    "onlyStagedChanges": false,
    "autoCommit": false,
    "autoPush": false,
    "promptForRefs": false
  },
  "gemini": {
    "model": "auto"
  },
  "openai": {
    "model": "gpt-3.5-turbo",
    "baseUrl": "https://api.openai.com/v1"
  },
  "codestral": {
    "model": "codestral-latest"
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2"
  },
  "telemetry": {
    "enabled": false
  }
}
```

### Custom Language Example

```json
{
  "commit": {
    "commitLanguage": "custom",
    "customLanguageName": "Ukrainian"
  }
}
```

On first use, this generates `.commitsage/language.json` with the translated template. See [custom-language.md](custom-language.md) for details.

### Partial Override Example

You only need to include the keys you want to override. Omitted keys fall through to VS Code settings (workspace → global). For example, to switch a single project to Ollama with emoji commits:

```json
{
  "provider": {
    "type": "ollama"
  },
  "commit": {
    "commitFormat": "emoji"
  }
}
```

### Notes

- Config is automatically watched — changes take effect immediately without reloading VS Code
- Invalid JSON will show an error notification (check for trailing commas or missing quotes)
- API keys are **not** stored in this file — they are managed via VS Code's secure storage
- You only need to include the settings you want to override; omitted settings fall through to VS Code settings

For troubleshooting configuration problems, see [troubleshooting.md](troubleshooting.md).

---

## API Key Management

API keys are stored in VS Code's secure storage (OS keychain), not in settings files.

**Set keys:** Command Palette → "Commit Sage: Set \<Provider\> API Key"

**Remove keys:** Command Palette → "Commit Sage: Remove \<Provider\> API Key"

Available commands:
- `Commit Sage: Set Gemini API Key` / `Remove Gemini API Key`
- `Commit Sage: Set OpenAI API Key` / `Remove OpenAI API Key`
- `Commit Sage: Set Codestral API Key` / `Remove Codestral API Key`
- `Commit Sage: Set Ollama Authentication Token` / `Remove Ollama Authentication Token`
