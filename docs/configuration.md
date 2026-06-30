# Configuration Reference

All settings are under the `commitSage.*` namespace in VS Code settings.

---

## Settings Priority

Settings are resolved in the following order (higher priority wins):

1. **Project settings** (`.commitsage/config.json`) — highest priority
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
| `commitSage.commit.refs.enabled` | `boolean` | `false` | Add an issue/ticket ref (e.g. `#123`, `PROJ-456`) to every generated commit |
| `commitSage.commit.refs.source` | `string` | `"prompt"` | Where the ref comes from: `prompt` (ask each time), `branch` (extract from branch name), `input` (fixed value) |
| `commitSage.commit.refs.value` | `string` | `""` | Fixed ref used when `refs.source` is `input` |
| `commitSage.commit.refs.placement` | `string` | `"end"` | Where the ref is added: `end` (separate line at end), `start` (separate line at start), or `prefix` (start of subject line, same line). Never injected into the subject scope |
| `commitSage.commit.refs.branchPattern` | `string` | `"[A-Z][A-Z0-9]*-[0-9]+"` | Regex extracting the ref from the branch name when `refs.source` is `branch`. First capture group, or whole match, is used |
| `commitSage.commit.useCustomInstructions` | `boolean` | `false` | Use custom prompt instead of built-in templates |
| `commitSage.commit.customInstructions` | `string` | `""` | Custom prompt text (used when `useCustomInstructions` is `true`) |

### Saving a ref per branch or per project (`input` source)

With `refs.source` set to `input`, the settings panel shows a **Ref value** field
with two buttons:

- **Save for this branch** — stores the value for the *current git branch* only,
  in VS Code's per-workspace state (`workspaceState`). It is personal and never
  committed to the repo.
- **Save for project** — writes `commit.refs.value` into `.commitsage/config.json`,
  so it applies to the whole repo and can be shared via git.

At generation time the **branch ref wins over the project ref** (more specific
scope first); if neither is set, no ref is added. A **Clear branch ref** button
removes the current branch's saved value.

---

## Other Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commitSage.apiRequestTimeout` | `number` | `30` | LLM provider HTTP request timeout in seconds (`-1` for no timeout) |
| `commitSage.gitTimeout` | `number` | `120` | `git` subprocess timeout in seconds (`-1` for no timeout). Raise if pushes over a slow remote or diffs over huge files time out. |
| `commitSage.telemetry.enabled` | `boolean` | `true` | Enable anonymous usage telemetry |

---

## Project Configuration (`.commitsage/config.json`)

CommitSage stores per-project settings in `.commitsage/config.json`.

| Layout | When used |
|--------|-----------|
| `.commitsage/config.json` (directory) | **Current** layout. Created by the `Create Project Config` command and read on every activation |
| `.commitsage` (single JSON file) | Legacy. Still loaded for backwards compatibility, and automatically migrated to `.commitsage/config.json` on next activation |

**Create via Command Palette:** "Commit Sage: Create Project Config (.commitsage)"

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
    "refs": {
      "enabled": false,
      "source": "prompt",
      "value": "",
      "placement": "end",
      "branchPattern": "[A-Z][A-Z0-9]*-[0-9]+"
    }
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

On first use, this generates `.commitsage/translations.json` with the translated template. See [custom-language.md](custom-language.md) for details.

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
