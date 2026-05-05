# VSCode API Audit — Modernization Opportunities

_Date: 2026-05-05_
_Engine target: `^1.93.0` (Sept 2024)_

This document audits the CommitSage extension against current VSCode extension-API best practices and identifies APIs we don't use that would simplify our code. It does **not** propose new features — only places where switching to a newer/native VSCode API removes hand-rolled code.

---

## Already aligned with current best practice

These are correct as-is — no action needed.

- **No `activationEvents` declared** — relies on the auto-detection added in 1.74. The extension activates lazily on first command invocation.
- **`SecretStorage` for API keys** — `apiKeyManager.ts` uses `context.secrets`. No fallback or hand-rolled encryption.
- **`vscode.git` extension API** for repo discovery — `gitService.ts:476-488`. We shell out only for `diff`/`commit`/`blame`, which is the supported pattern.
- **`withProgress` + `CancellationToken`** propagated through to `AbortSignal` in HTTP calls — `commitWorkflow.ts:38-56`. Textbook cancellation flow.
- **`createFileSystemWatcher` + `RelativePattern`** for `.commitsage/config.json` reactive reload — `configService.ts:142-160`.
- **All disposables registered** on `context.subscriptions` and disposed in reverse order on deactivate.

---

## Real simplification opportunities (worth doing)

### 1. `LogOutputChannel` instead of plain `OutputChannel`

**What we do now**: `logger.ts:7` creates a plain `OutputChannel`, then 4 static methods (`log`/`error`/`warn`) hand-format `[ISO][LEVEL] message` and append.

**What's simpler**: `vscode.window.createOutputChannel('Commit Sage', { log: true })` returns a `LogOutputChannel` with native `trace`/`debug`/`info`/`warn`/`error` methods. VSCode formats the timestamp and severity prefix itself, applies the user's chosen log level, and shows a level switcher in the channel UI.

**Net effect**: `logger.ts` shrinks from ~55 lines to ~25; the `[INFO]/[WARN]/[ERROR]` formatters all disappear. Behaviour is strictly better — log level filtering for free.

**Available since**: 1.74.

---

### 2. `vscode.env.createTelemetryLogger` wrapping Amplitude

**What we do now**: `telemetryService.ts:50` calls `amplitude.init` directly, then maintains its own `enabled` flag, listens to `vscode.env.onDidChangeTelemetryEnabled`, listens to `onDidChangeConfiguration` for `commitSage.telemetry.enabled`, manually toggles `amplitude.setOptOut`. Three places stay in sync by hand.

**What's simpler**: implement a thin `TelemetrySender` (one method: `sendEventData`) that calls `amplitude.track`. Pass it to `vscode.env.createTelemetryLogger(sender)`. VSCode then:

- automatically respects `vscode.env.isTelemetryEnabled` and the user's per-extension telemetry setting,
- mirrors every event into a hidden "telemetry" output channel for transparency (a marketplace requirement people increasingly check),
- sanitizes common PII patterns before forwarding.

**Net effect**: removes the `handleTelemetryStateChange` listener, the `enabled` field, and the manual `setOptOut` plumbing. Amplitude stays — it sits inside the sender. ~30 lines drop out of `telemetryService.ts`.

**Caveat**: our `commitSage.telemetry.enabled` extension-level toggle still needs to be honoured (the global VSCode flag isn't the only gate); we keep that one config listener. So the simplification is "no VSCode-side glue", not "no listeners at all".

**Available since**: 1.75.

---

### 3. Webpack → esbuild

**What we do now**: `webpack.config.js` (38 lines) + `webpack`, `webpack-cli`, `ts-loader`, `webpack-bundle-analyzer`, `dotenv-webpack` devDeps.

**What's simpler**: VSCode's official extension samples repo migrated to esbuild ~2 years ago. An `esbuild.js` script is ~25 lines, no loader plugins. Build is roughly 10× faster (tens of ms vs ~1 s for our bundle size). `define:` replaces `dotenv-webpack`. `--analyze` becomes `esbuild --metafile`.

**Net effect**: 5 devDeps removed, faster CI, simpler config.

**Risk**: non-zero — this is build infra. Needs careful verification (vsix size, source map quality, runtime smoke test). Recommend a separate PR from items 1/2/4.

---

### 4. `capabilities.virtualWorkspaces` + `capabilities.untrustedWorkspaces`

**What we do now**: not declared. VSCode prompts and behavior fall back to permissive defaults.

**What's correct**: we shell out to `git`, read `.commitsage/`, send commits — none of this works in a virtual workspace, and arbitrary repos can be untrusted code. Add a `capabilities` block in `package.json`:

```json
"capabilities": {
  "virtualWorkspaces": {
    "supported": false,
    "description": "Commit Sage requires a local git repository."
  },
  "untrustedWorkspaces": {
    "supported": "limited",
    "description": "Generates messages from diffs; do not auto-commit in untrusted workspaces.",
    "restrictedConfigurations": [
      "commitSage.commit.autoCommit",
      "commitSage.commit.autoPush"
    ]
  }
}
```

**Net effect**: 6 lines added to `package.json`, no code change. Marketplace badges + correct UX in restricted modes.

---

## Worth flagging, lower priority

### 5. `markdownDescription` on contributed settings

The settings panel renders markdown when you use `markdownDescription` instead of `description`. Lets us link to README sections, format URLs, bold the gotcha lines (e.g., `commit.autoPush` requires `autoCommit`). Pure UX polish, no code change beyond `package.json`.

---

### 6. Native `fetch` instead of axios (defer)

Node 20 (shipped by VSCode 1.93) has stable `fetch` + `AbortController`. Dropping axios would save ~500KB in the bundle.

**But**: `httpUtils.ts` and `withRetryAndApiKeyGuard` are built around the `AxiosError` shape (`error.response.status`, `error.code === 'ECONNREFUSED'`, etc.), and four provider services depend on that shape. The migration touches 6 files and reworks the error mapper. **Real simplification**, but a bigger lift than the others.

---

### 7. `vscode.workspace.fs` for `.commitsage/` (skip)

Only matters for virtual-workspace support, which we explicitly don't claim (see item 4). Node `fs` is correct here.

---

### 8. `vscode.l10n` localization (skip)

We have a "language" config that translates the *output* (commit messages) via the LLM. The extension's own UI strings ("API key removed", "No changes detected", etc.) are English-only. Adding `vscode.l10n` would require a `bundle.l10n.json` and translations for ~40 strings — meaningful work, low ROI for this user base. Defer until requested.

---

### 9. Walkthroughs contribution (skip — UX feature, not simplification)

A `walkthroughs` contribution gives new users an onboarding flow (set API key → pick provider → try generating). Useful but *additive*, not a simplification. Out of scope for this audit.

---

### 10. `configuration.scope` on settings (low value)

Could mark `commitSage.openai.baseUrl` etc. as `application` scope, but the current implicit `window` scope works fine and our `ConfigService` already handles workspace-vs-global correctly via `inspect()`. Skip.

---

## Recommendation: focused 4-item PR

The best ratio of "simplifies code" to "risk":

| # | Change | File(s) | Risk |
|---|---|---|---|
| 1 | `Logger` → `LogOutputChannel` | `src/utils/logger.ts` | Low |
| 2 | Telemetry → `createTelemetryLogger` wrapping Amplitude | `src/services/telemetryService.ts` | Low |
| 3 | `capabilities` block | `package.json` | None (config only) |
| 4 | `markdownDescription` on settings where it adds value | `package.json` | None |

**Estimated diff**: ~80 lines deleted, ~30 added. No user-visible behaviour change except a richer log/telemetry experience and correct trust badges.

**Item 3 (Webpack → esbuild) is a separate PR** because it's build-infra and warrants its own verification cycle.

---

## Verification (for the recommended PR)

- `npm run typecheck` clean.
- `npm run lint` clean.
- `npm run test` (vitest) — `tests/__mocks__/vscode.ts` needs stubs for `LogOutputChannel` and `env.createTelemetryLogger`.
- Manual: F5 → activate extension → run `Generate Commit Message` → verify Output panel shows the new log channel with level switcher; verify a telemetry event appears in the "Telemetry" output channel.
- Sanity-check `.vsix` size before/after with `npm run package`.

---

## Out of scope

- Native `fetch` migration (item 6) — defer.
- `vscode.l10n` localization (item 8) — defer.
- Walkthroughs (item 9) — additive feature, not simplification.
- esbuild migration (item 3) — recommended as a follow-up PR, not mixed with items 1/2/4/5.
