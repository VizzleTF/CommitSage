# Telemetry

Commit Sage sends pseudonymous usage events to Amplitude, EU server zone. This page lists every event and property it sends and how to turn telemetry off. The same list ships in the extension as `telemetry.json`, so `code --telemetry` prints it.

The diff, the commit message and error messages are not sent. A failure event carries the error name and a [category](#error-categories), never git's stderr or the provider's reply. Amplitude receives each request and so sees the client IP address; the Amplitude SDK setup in Commit Sage sets only the EU server zone and batching options.

## Turn telemetry off

Commit Sage sends events only when both settings allow it:

- VS Code telemetry, `telemetry.telemetryLevel`. `off` stops all Commit Sage events. At `error` or `crash`, VS Code blocks usage events and still passes error events such as `extension_error` to the Commit Sage sender.
- `commitSage.telemetry.enabled` (default `true`). `false` in user settings, workspace settings or `.commitsage/config.json` turns events off. A workspace or project `true` does not override a user `false`, so a cloned repository cannot turn telemetry back on. A project can opt out for everyone:

```json
{
  "telemetry": {
    "enabled": false
  }
}
```

Commit Sage reads the project config value at startup. A change in VS Code settings applies at once.

## Properties on every event

| Property | Example | Description |
|---|---|---|
| `vsCodeVersion` | `1.95.0` | VS Code version |
| `extensionVersion` | `3.3.4` | Commit Sage version |
| `platform` | `win32`, `darwin`, `linux` | Operating system (`process.platform`) |

Commit Sage sends events through the VS Code telemetry logger with its built-in common properties turned off, so the VS Code session, SQM and device IDs are not added. Each event carries `vscode.env.machineId` as the Amplitude device ID. VS Code generates this ID and it is not linked to an account, but it stays the same across sessions, so the events are pseudonymous, not anonymous.

## Events

The names below are the names Commit Sage passes to the VS Code telemetry logger. The logger prefixes them with the extension ID, so Amplitude stores `VizzleTF.geminicommit/commit_completed`. `extension_error` is stored without the prefix.

| Event | Sent when | Properties |
|---|---|---|
| `extension_activated` | The extension starts. | none |
| `extension_deactivated` | VS Code closes or the extension is disabled. | none |
| `message_generation_started` | Generation begins. | `provider`, `model`, `diffSize`, `fileCount`, `truncated` |
| `message_generation_completed` | The provider returns a message. | `provider`, `model`, `durationMs`, `language`, `onlyStagedChanges` |
| `message_generation_failed` | Generation fails, except for an invalid API key and a cancellation. | `provider`, `model`, `errorType`, `errorCategory` |
| `commit_completed` | Auto-commit runs `git commit` successfully. | `fileCount`, `messageLength` |
| `commit_failed` | Auto-commit fails. | `errorType`, `errorCategory` |
| `push_completed` | Auto-push runs `git push` successfully. | none |
| `push_failed` | Auto-push fails. | `errorType`, `errorCategory` |
| `settings_changed` | A `commitSage.*` setting changes in VS Code settings. Edits to `.commitsage/config.json` do not send it. | `setting` |
| `extension_error` | An unhandled error in Commit Sage code reaches the VS Code telemetry logger. | `errorType`, `errorCategory`, `errorStack` |

## Event properties

| Property | Type | Description |
|---|---|---|
| `provider` | `string` | Value of `commitSage.provider.type`, one of the providers in [providers.md](providers.md) |
| `model` | `string` | In `message_generation_started` and `_failed`: the configured model. In `_completed`: the model that produced the message |
| `diffSize` | `number` | Diff length in characters, before truncation |
| `fileCount` | `number` | In `message_generation_started`: number of changed files analyzed. In `commit_completed`: number of files in the commit |
| `truncated` | `boolean` | `true` when the diff is longer than `commitSage.general.maxDiffSize` (default `100000`, `-1` disables truncation) |
| `durationMs` | `number` | Milliseconds from the start of generation to the result |
| `language` | `string` | Value of `commitSage.commit.commitLanguage` |
| `onlyStagedChanges` | `boolean` | `true` when only staged changes were analyzed |
| `messageLength` | `number` | Commit message length in characters |
| `setting` | `string` | Changed setting name without the `commitSage.` prefix, for example `commit.commitFormat` |
| `errorType` | `string` | Error name (`error.name`), for example `Error`, `GitCommandError` or `NoChangesDetectedError` |
| `errorCategory` | `string` | One of the [error categories](#error-categories) |
| `errorStack` | `string` | Stack frames, the lines that start with `at`, after [redaction](#redaction). The message lines of the stack trace are dropped |

## Error categories

| Category | Meaning |
|---|---|
| `auth` | Invalid API key, HTTP 401 or 403 |
| `rate_limit` | HTTP 429 |
| `network` | Connection or DNS failure, or a reply that is not valid JSON |
| `timeout` | The request or a git command timed out |
| `server` | HTTP 5xx |
| `http` | Any other HTTP error status, such as 400 or 404 |
| `git` | A git command exited with an error |
| `cancelled` | The user cancelled the operation |
| `other` | Anything else |

## Redaction

Commit Sage redacts `errorStack` before sending. It replaces:

- absolute file paths that end in a file extension, such as `/home/<USER>/project/src/file.ts` or `C:\Users\<USER>\file.ts`, with `<path>`;
- `key=` URL query values with `key=<redacted>`;
- `Bearer` tokens with `Bearer <redacted>`;
- `x-goog-api-key:` header values with `x-goog-api-key: <redacted>`;
- `Authorization:` header values with `Authorization: <redacted>`.

Redaction matches these patterns, plus the token formats Commit Sage masks in diffs. Paths without a file extension, such as directory paths, and other text inside a stack frame are sent as they are.
