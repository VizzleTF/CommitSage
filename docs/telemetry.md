# Telemetry

Commit Sage sends anonymous usage events to Amplitude, EU server zone. This page lists every event and property it sends and how to turn telemetry off.

The diff and the commit message are not sent as event fields. Error fields carry the provider's error text after [redaction](#redaction), and that text may quote request content. Amplitude receives each request and so sees the client IP address; the Amplitude SDK setup in Commit Sage sets only the EU server zone and batching options.

## Turn telemetry off

Commit Sage sends events only when both settings allow it:

- VS Code telemetry, `telemetry.telemetryLevel`. `off` stops all Commit Sage events. At `error` or `crash`, VS Code blocks usage events and still passes error events such as `extension_error` to the Commit Sage sender.
- `commitSage.telemetry.enabled` (default `true`). Set it to `false` in VS Code settings, or in `.commitsage/config.json`:

```json
{
  "telemetry": {
    "enabled": false
  }
}
```

Commit Sage reads the project config value at startup. A change in VS Code settings applies at once.

## Properties on every event except `extension_error`

| Property | Example | Description |
|---|---|---|
| `vsCodeVersion` | `1.95.0` | VS Code version |
| `extensionVersion` | `3.3.4` | Commit Sage version |
| `platform` | `win32`, `darwin`, `linux` | Operating system (`process.platform`) |

Commit Sage sends events through the VS Code telemetry logger, which also adds its built-in common properties, such as the operating system and the extension name. Each event carries `vscode.env.machineId` as the Amplitude device ID. VS Code generates this ID; it is not linked to an account.

## Events

The names below are the names Commit Sage passes to the VS Code telemetry logger. The event names stored in Amplitude are not documented here.

| Event | Sent when | Properties |
|---|---|---|
| `extension_activated` | The extension starts. | none |
| `extension_deactivated` | VS Code closes or the extension is disabled. | none |
| `message_generation_started` | Generation begins. | `provider`, `model`, `diffSize`, `fileCount`, `truncated` |
| `message_generation_completed` | The provider returns a message. | `provider`, `model`, `durationMs`, `language`, `onlyStagedChanges` |
| `message_generation_failed` | Generation fails, except for an invalid API key and a cancellation. | `provider`, `model`, `error`, `errorType` |
| `commit_completed` | Auto-commit runs `git commit` successfully. | `hasStaged`, `hasUntracked`, `hasDeleted`, `messageLength` |
| `commit_failed` | Auto-commit fails. | `error`, `errorType` |
| `push_completed` | Auto-push runs `git push` successfully. | none |
| `push_failed` | Auto-push fails. | `error`, `errorType` |
| `settings_changed` | A `commitSage.*` setting changes in VS Code settings. Edits to `.commitsage/config.json` do not send it. | `setting` |
| `extension_error` | An unhandled error in Commit Sage code reaches the VS Code telemetry logger. | `errorMessage`, `errorStack` |

## Event properties

| Property | Type | Description |
|---|---|---|
| `provider` | `string` | Value of `commitSage.provider.type`, one of the providers in [providers.md](providers.md) |
| `model` | `string` | In `message_generation_started` and `_failed`: the configured model. In `_completed`: the model that produced the message |
| `diffSize` | `number` | Diff length in characters, before truncation |
| `fileCount` | `number` | Number of changed files analyzed |
| `truncated` | `boolean` | `true` when the diff is longer than `commitSage.general.maxDiffSize` (default `100000`, `-1` disables truncation) |
| `durationMs` | `number` | Milliseconds from the start of generation to the result |
| `language` | `string` | Value of `commitSage.commit.commitLanguage` |
| `onlyStagedChanges` | `boolean` | `true` when only staged changes were analyzed |
| `hasStaged`, `hasUntracked`, `hasDeleted` | `boolean` | Whether the commit had staged, untracked or deleted files |
| `messageLength` | `number` | Commit message length in characters |
| `setting` | `string` | Changed setting name without the `commitSage.` prefix, for example `commit.commitFormat` |
| `error` | `string` | Error message after redaction |
| `errorType` | `string` | Error class name, for example `Error` or `NoChangesDetectedError` |
| `errorMessage` | `string` | Error message after redaction |
| `errorStack` | `string` | Stack trace after redaction |

## Redaction

Commit Sage applies the same redaction to `error`, `errorMessage` and `errorStack` before sending. It replaces:

- absolute file paths that end in a file extension, such as `/home/<USER>/project/src/file.ts` or `C:\Users\<USER>\file.ts`, with `<path>`;
- `key=` URL query values with `key=<redacted>`;
- `Bearer` tokens with `Bearer <redacted>`;
- `x-goog-api-key:` header values with `x-goog-api-key: <redacted>`;
- `Authorization:` header values with `Authorization: <redacted>`.

Redaction matches these patterns only. Paths without a file extension, such as directory paths, and other text inside an error message or stack trace are sent as they are.
