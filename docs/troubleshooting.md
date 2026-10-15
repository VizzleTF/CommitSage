# Troubleshooting

This page lists the errors that Commit Sage shows and how to fix each one. Notifications start with `Commit Sage: `, and the messages below omit that prefix. The `.commitsage` syntax-error dialog has no prefix. The full error for each failed attempt is in **View → Output → Commit Sage**.

Settings named here are described in [configuration.md](configuration.md). Provider setup is in [providers.md](providers.md).

## Generating a message

| Message or symptom | Cause | Action |
|---|---|---|
| `No workspace folder is open` | VS Code has no folder open. | Open the repository folder. |
| `No changes detected.` | The repository has no staged, unstaged, untracked or deleted files. | Run `git status` in the repository and make a change. |
| `No staged changes. Stage files or turn off commitSage.commit.onlyStagedChanges.` | `commitSage.commit.onlyStagedChanges` is `true` and nothing is staged. | Stage the files to commit, or set `commitSage.commit.onlyStagedChanges` to `false`. |
| `git <COMMAND> output is too large`, sometimes after `Failed to get diff: ` | The list of changed files is longer than 200,000 characters. | Commit the changes in smaller parts, or add generated files to `.gitignore`. |
| The message names a file but not what changed in it, or mentions `<redacted>` | The file matches `commitSage.general.excludeFiles` or `.commitsageignore`, so the model saw only its path, or a line looked like a secret and was masked. See [Sensitive files and secrets](configuration.md#sensitive-files-and-secrets). | Edit the message by hand. To send the file's content, remove its pattern from the setting or `.commitsageignore`. |
| `No Git repositories found in the current workspace.` | The open folder holds no Git repository. | Open the folder that contains `.git`. |
| `Repository has no configured remotes. Please add a remote repository using git remote add <name> <url>` | Auto-push ran in a repository without a remote. | Add a remote with `git remote add <NAME> <URL>` or set `commitSage.commit.autoPush` to `false`. |
| `Failed to set API key: <CAUSE>` | The key failed the format check or could not be stored. | Read `<CAUSE>` and paste the key again without spaces or extra characters. |
| `Git extension not found. Please make sure it is installed and enabled.` | The built-in VS Code Git extension is disabled. | Enable the Git extension in the Extensions view. |
| `Custom Instructions are enabled but empty. Please add some instructions.` (warning at startup) | `commitSage.commit.useCustomInstructions` is `true` and `commitSage.commit.customInstructions` is empty. | Fill in `commitSage.commit.customInstructions` or set `useCustomInstructions` to `false`. |

### `Ctrl+G` / `Cmd+G` does nothing

The shortcut has the `when` clause `scmProvider == git`. It works when focus is in the Source Control view of a Git repository.

1. Click in the Source Control view and press the shortcut again.
2. From the editor or another view, run **Commit Sage: Generate Commit Message** from the Command Palette.
3. If the shortcut still does nothing, open the Keyboard Shortcuts editor, search for `commitsage.generateCommitMessage` and remove the conflicting binding.

## API key errors

### `Invalid or expired API key. Please enter a new one.`

The provider rejected the API key: HTTP 401, or HTTP 400 with an "invalid API key" or "API key not valid" message (xAI, Gemini). Commit Sage deletes the stored key and opens an input box for a new one.

1. Paste a new key from the provider console. For Codestral, the key comes from `https://console.mistral.ai/codestral` and differs from a Mistral La Plateforme key.
2. If three new keys in a row are rejected, Commit Sage shows `Invalid or expired API key. Maximum retry attempts reached.` Check that the key belongs to the provider set in `commitSage.provider.type`, then run **Commit Sage: Set <PROVIDER> API Key**.

## Provider and network errors

A failed request is tried up to three times (two retries, after 1 s and 2 s). After the last attempt, Commit Sage shows `Failed to generate commit message: <CAUSE>`. The table lists each `<CAUSE>`.

| `<CAUSE>` after `Failed to generate commit message: ` | Cause | Action |
|---|---|---|
| `Rate Limit Exceeded: Too many requests in a short time period. Please wait a moment before trying again.` | The provider returned HTTP 429. | Wait and run the command again, or switch to another model or provider. |
| `Payment Required: Your API key requires a valid subscription or has exceeded its quota. Please check your billing status.` | The provider returned HTTP 402. | Add credit or a plan in the provider console. |
| `Authentication Error: The API key is invalid or has been revoked. Please check your API key.` | The provider returned HTTP 403 without an error text. | Create a new key in the provider console and set it with **Commit Sage: Set <PROVIDER> API Key**. |
| `Invalid Request: The request was malformed or the input was invalid. This may happen if the content is too long or contains unsupported characters.` | The provider returned HTTP 422 without an error text. | Lower `commitSage.general.maxDiffSize` or stage fewer files. |
| `Server Error: The service is temporarily unavailable. Please try again later.` | The provider returned HTTP 500. | Run the command again later. |
| `Not Found: The model may be retired or misspelled, or the base URL is wrong. Pick a current model in the Commit Sage sidebar. (<DETAIL>)` | The provider returned HTTP 404, usually because the configured model was retired or renamed. `<DETAIL>` is the provider's own text and is left out when empty. | Press `Refresh` in the sidebar and pick a model from the list. If the model exists, check the provider's base URL setting. |
| `Invalid response format from <PROVIDER> API` | The response held no message text. | Run the command again, or pick another model. |
| `Generated commit message is empty.` | Nothing was left of the reply after cleanup: Commit Sage removes `<think>` blocks, an outer code fence, wrapping quotes, a leading "Here is the commit message:" line, `Signed-off-by` lines and invisible control characters. | Run the command again, or pick another model. |
| `API Error: <STATUS>: <DETAIL>` | The provider returned another HTTP status. | Read `<DETAIL>`: it is the provider's own error text. |
| ``<PROVIDER> stopped generating before the message was complete (<DETAIL>). Raise `commitSage.general.maxOutputTokens` if this keeps happening.`` | The model used up its output token budget, often on reasoning. | Raise `commitSage.general.maxOutputTokens` or pick a model without reasoning. |

### `Failed to generate commit message: Could not connect to <PROVIDER> API. Please check your internet connection.`

The request did not reach the provider or got no answer in time. Commit Sage shows this message for DNS failures, refused connections, TLS certificate errors and timeouts. The Output panel shows the exact network error, such as `Request timed out.` or `ECONNREFUSED`.

1. Check the base URL in `commitSage.openai.baseUrl`, `commitSage.custom.baseUrl` or `commitSage.ollama.baseUrl` for the active provider.
2. Check that the endpoint answers from this machine: `curl <BASE_URL>/models`.
3. If the Output panel shows `Request timed out.`, raise `commitSage.apiRequestTimeout` (seconds, default `30`, `-1` disables the timeout) or pick a smaller, faster model.

The Ollama provider shows its own connection message; see [Ollama](#ollama).

## Gemini

| Message | Cause | Action |
|---|---|---|
| `All models failed. Errors: <MODEL>: <ERROR>; …` | `commitSage.gemini.model` is `auto`, and every model available to the key failed. | Read `<ERROR>` for each model and fix the first cause in the tables above. |
| `Gemini model "<MODEL>" is no longer available. Choose a current model or switch to auto.` | The configured model is missing from the live model list for the key. | Click **Pick a model** or **Switch to auto**. |
| `No Gemini models available for this API key` | The key has access to no models. | Create a key at `https://aistudio.google.com/app/apikey`. |

## Ollama

| `<CAUSE>` after `Failed to generate commit message: ` | Cause | Action |
|---|---|---|
| `Could not connect to Ollama. Please make sure Ollama is running.` | Ollama is not running or listens on another address. | Run `ollama serve`, check `curl http://localhost:11434/api/tags`, and match `commitSage.ollama.baseUrl` to the address. |
| `Model not found. Please check if Ollama is running and the model is installed.` | Ollama returned HTTP 404: the model in `commitSage.ollama.model` is not pulled. | Run `ollama pull <MODEL>`. |
| `Server error. Please check if Ollama is running properly.` | Ollama returned HTTP 500. | Check the Ollama server log. |

A remote Ollama server that requires a token needs `commitSage.ollama.useAuthToken` set to `true` and the token set with **Commit Sage: Set Ollama Auth Token**. If the server returns HTTP 401 while `useAuthToken` is `false`, Commit Sage shows `ollama returned 401. Turn on commitSage.ollama.useAuthToken and set the token.` instead of asking for a new token. The `custom` provider does the same with `commitSage.custom.useApiKey`.

## OpenAI-compatible servers (LocalAI, LM Studio, vLLM, llama.cpp)

These servers use the `custom` provider. Set `commitSage.provider.type` to `custom` and `commitSage.custom.baseUrl` to the server, for example `http://localhost:1234/v1` for LM Studio. Set `commitSage.custom.useApiKey` to `true` only if the server checks a key, and change `commitSage.custom.chatCompletionsPath` only if the server does not serve `/chat/completions`. Connection errors follow the network section above.

## Project config

### `Invalid .commitsage configuration file. The file contains syntax errors.`

Commit Sage shows this dialog with **Open File** and **Ignore** buttons at startup and after each edit of `.commitsage/config.json`. The file is not valid JSON or is not a JSON object at the top level. Commit Sage ignores the whole file until it parses.

1. Click **Open File** in the dialog.
2. Fix the syntax: trailing commas, missing quotes, unmatched braces.
3. Save the file. Commit Sage reloads it and checks it again without a window reload.

### Project config values are ignored

Check **View → Output → Commit Sage**:

- `Ignoring project config "<KEY>": the workspace is not trusted.` In an untrusted workspace the project config cannot set the keys listed in [configuration.md](configuration.md#workspace-trust). Trust the workspace to apply them.
- `"<KEY>" expected <TYPE>, got <TYPE> — skipping.` The value has the wrong type, for example `"true"` in quotes for a boolean. Fix the type and save the file.

### Custom language translation is requested on every run

Commit Sage cannot write `.commitsage/translations.json`, so it translates the template again on each run. The Output panel shows `Failed to save translation:`, and `Failed to create .commitsage directory:` when the directory is missing.

The usual cause is a legacy `.commitsage` file with invalid JSON in the project root. Commit Sage moves a legacy file into `.commitsage/config.json` only when its JSON is valid, and the file blocks the directory. The Output panel then also shows `Failed to migrate .commitsage config:`.

1. Fix the JSON in the `.commitsage` file.
2. Run **Developer: Reload Window**. Commit Sage moves the file to `.commitsage/config.json` at startup.
3. If no `.commitsage` file exists, check that the project folder is writable.

## Reporting a problem

[Open an issue](https://github.com/VizzleTF/CommitSage/issues) with the VS Code version, the Commit Sage version, the steps to reproduce and the lines from **View → Output → Commit Sage**.
