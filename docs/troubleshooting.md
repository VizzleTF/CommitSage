# Troubleshooting

## General

### "No changes detected"

Commit Sage analyzes git changes in the workspace root.

- Run `git status` and verify there are staged or unstaged changes
- If `commitSage.commit.onlyStagedChanges` is `true`, ensure changes are staged (`git add`)
- Check that VS Code has opened the correct folder (the one containing `.git`)

### "Failed to generate commit message"

This is a generic error — check the output panel (View → Output → Commit Sage) for the specific cause.

---

## API & Network Errors

### 401 Unauthorized

Your API key is invalid or not set.

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run "Commit Sage: Set \<Provider\> API Key"
3. Paste a fresh key from your provider's console

### 429 Too Many Requests / Rate Limit

You have exceeded the provider's rate limit.

- Wait a moment and retry
- Switch to a different model or provider
- For Gemini, `auto` mode will try alternative models automatically

### Request Timeout

The request exceeded `commitSage.apiRequestTimeout` (default: 30 seconds).

- Increase the timeout value in settings (`-1` disables the timeout)
- Check your internet connection
- Try a faster model (e.g., `gemini-2.0-flash-lite` instead of `gemini-2.5-pro`)

### SSL / Certificate Errors

Common when using a corporate proxy or custom endpoint.

- Verify the `baseUrl` is correct (OpenAI / Ollama settings)
- Check that the endpoint is reachable: `curl <baseUrl>/models`

---

## Provider-Specific

### Gemini

**"API key not valid"** — The key from Google AI Studio is not activated yet (can take a few minutes) or belongs to a different project. Generate a new key at [aistudio.google.com](https://aistudio.google.com/app/apikey).

**Model not available in your region** — Use `auto` mode; it fetches the list of models available to your account and tries them in order.

### OpenAI / Custom Endpoint

**"model not found"** — The model name in `commitSage.openai.model` does not exist on the endpoint. Check the model list from your provider and update the setting.

**Azure OpenAI** — Set `baseUrl` to your Azure deployment URL: `https://<resource>.openai.azure.com/openai/deployments/<deployment>`. The model field should match the deployment name.

**LocalAI / Ollama as OpenAI-compatible endpoint** — Set `baseUrl` to your local server (e.g., `http://localhost:8080/v1`). Leave the API key blank or set any non-empty string.

### Codestral

**"Unauthorized"** — Codestral requires a separate API key from [console.mistral.ai/codestral](https://console.mistral.ai/codestral), distinct from the general Mistral API key.

### Ollama

**"Connection refused"** — Ollama is not running or not listening on the expected port.

1. Start Ollama: `ollama serve`
2. Verify it is accessible: `curl http://localhost:11434/api/tags`
3. Check `commitSage.ollama.baseUrl` matches the actual address

**"Model not found"** — Pull the model first: `ollama pull llama3.2`

**Using Ollama on a remote machine** — Set `baseUrl` to the remote address and enable `commitSage.ollama.useAuthToken` if authentication is required.

---

## Project Configuration (`.commitsage`)

### Settings are not applied

- Check that the file is in the **project root** (same directory as `.git`)
- Validate the JSON syntax — VS Code will show a red squiggle on invalid JSON, and Commit Sage will show an error notification on save
- Settings in `.commitsage` override VS Code settings; API keys are always read from VS Code's secure storage regardless

### "Invalid JSON" notification on save

Open the `.commitsage` file and look for:
- Trailing commas after the last item in an object or array
- Missing quotes around string values
- Mismatched braces

---

## Extension Not Working

### Keyboard shortcut `Cmd+G` / `Ctrl+G` does nothing

- Ensure the Source Control view is focused, or try the Command Palette: "Commit Sage: Generate Commit Message"
- Check for keybinding conflicts: Keyboard Shortcuts editor → search "commitsage"

### Extension not appearing in Source Control

- Verify Commit Sage is installed and enabled (Extensions sidebar)
- Reload VS Code window: Command Palette → "Developer: Reload Window"

### After updating, behavior changed unexpectedly

Check the [GitHub releases](https://github.com/VizzleTF/CommitSage/releases) for changelog notes. If you suspect a regression, [open an issue](https://github.com/VizzleTF/CommitSage/issues) with your VS Code version, extension version, and steps to reproduce.
