# Tech Debt Audit — CommitSage

Generated: 2026-04-30 (repeat run; previous audit covered F001–F047)
Repeat-run sweep #2: 2026-04-30 — F048–F059 all resolved in this commit.
Repo size: 5,656 LOC TypeScript across 43 src files + 1,012 LOC across 11 test files. VS Code extension, single module.
Tooling actually run: `tsc --noEmit` (clean), `npm test` (95/95 pass), `npm audit --omit=dev` (0 vulns), `npm run lint` (clean), `npm run build:prod` (clean, 415 KiB minified bundle), `npx knip`, `npx madge --circular` (no cycles), `npx depcheck`, `git log`, manual code reading.

## Executive summary (post-sweep #2 — COMPLETED)

All 59 findings worked through — F001–F059 ✅ Done. The 12 third-order findings (F048–F059) closed in this commit:

- **F048 (✅ Done, Medium)** — `codestral.model` default unified to `codestral-latest` in `SETTING_DEFAULTS`. Schema-sync test rewritten to walk **every** key in `SETTING_DEFAULTS` and assert `package.json.default === SETTING_DEFAULTS[key]`, replacing the old 9-key spot-check. `SETTING_DEFAULTS` is now exported so the test compares the constant directly (not via `ConfigService.get`, which would tautologically pass once F058's `inspect()` shim returns package.json values).
- **F049 (✅ Done, Low)** — `.commitsage/language.json` → `.commitsage/translations.json` in `package.json:171` (VS Code settings UI description) and `docs/configuration.md:138`. Now matches the real file used by `customLanguageService`.
- **F050 (✅ Done, Low)** — `.commitsage.example` updated to `"model": "auto"` (was `gemini-1.5-flash`, no longer in the enum).
- **F051 (✅ Done, Low)** — `Logger.show()` and the unreachable `'Show Details'` branch removed from `src/utils/logger.ts`. ~10 LOC dead code gone.
- **F052 (✅ Done, Medium)** — `AbortSignal` now flows through `GitService.executeGitCommand`, `getDiff`, `getChangedFiles`, `hasChanges`, `hasHead`, all four diff-helpers, and `GitBlameAnalyzer.analyzeChanges`. `commitWorkflow.generateAndApplyMessage` passes the existing `signal` into all three call sites. `mapLimit` also takes a `signal` and bails-fast: workers stop pulling new items, the call rejects with `AbortError`-shaped error.
- **F053 (✅ Done, Low)** — `extension.activate` no longer calls `validateGitExtension` directly; `initialize()` already does. One line removed.
- **F054 (✅ Done, Low)** — 10 unused keys removed from `errorMessages`. The remaining 9 keys are all referenced.
- **F055 (✅ Done, Low)** — `export` removed from `ChangedFile`, `TelemetryEvent`, `CommitTemplate`. Internal-only types are now correctly internal.
- **F056 (✅ Done, Low)** — `terser-webpack-plugin` removed from `devDependencies` via `npm uninstall`. Webpack production mode auto-uses bundled TerserPlugin; verified `npm run build:prod` still emits a 415 KiB minified bundle.
- **F057 (✅ Done, Low)** — `Build` step removed from `.github/workflows/release.yml`. `vsce package` runs `vscode:prepublish` (webpack production) automatically — no separate dev-mode build needed. Saves ~30s of CI on every release.
- **F058 (✅ Done, Low)** — `getConfiguration().inspect()` shim added to `tests/__mocks__/vscode.ts`. Returns `undefined` so the SETTING_DEFAULTS fallback path runs by default in tests; tests that need a workspace/global value mock `ConfigService` directly. Eliminates the F048-style blind spot from the mock.
- **F059 (✅ Done, Low)** — `ApiKeyManager.requiresApiKey` removed; the `provider in API_KEY_CONFIGS` check is now inlined into the only consumer, `requiresKeyForCurrentConfig`.

All findings F001–F047 also verified RESOLVED in current code.

## Architectural mental model

CommitSage is a VS Code extension (~5.6k LOC) that generates commit messages by combining `git diff` output with an LLM call. The pipeline is linear:

1. **Activation** (`src/extension.ts`) initialises five static-class services (`ConfigService`, `ApiKeyManager`, `Logger`, `TelemetryService`, `GitService`) and registers commands.
2. **Command entry** (`src/commands/generateCommitMessage.ts`) → `CommitWorkflow.generateAndSetCommitMessage` orchestrates the pipeline.
3. **Diff collection** (`src/services/gitService.ts`) spawns `git` subprocesses with bounded concurrency (`GIT_FANOUT_CONCURRENCY = 8`), capped stdout (`GIT_OUTPUT_BUFFER_CAP = 200_000`), and an `AbortSignal`-driven kill path.
4. **Blame analysis** (`src/services/gitBlameAnalyzer.ts` + `gitBlameParser.ts`) attributes changed lines to authors. Pure-function parsing kept separate from process spawning.
5. **Prompt construction** (`src/services/promptService.ts`) selects a static template (`src/templates/formats/*.ts`, 8 formats × 9 languages) or, for `commitLanguage = 'custom'`, lazily LLM-translates and caches in `.commitsage/translations.json` (`src/services/customLanguageService.ts`).
6. **Provider call** — `AIServiceFactory` dispatches to one of four static services (Gemini / OpenAI / Codestral / Ollama). Three of them go through `withRetryAndApiKeyGuard` in `baseAIService.ts` (a recent F042 unification); Ollama does its own retry-mapping for 404/500.
7. **Telemetry** (`src/services/telemetryService.ts`) is fire-and-forget through the `@amplitude/analytics-node` SDK, batched by the SDK itself after F047.

Configuration follows a strict precedence: `.commitsage/config.json` (project) → VS Code workspace → VS Code global → `SETTING_DEFAULTS` constant. The dual-source-of-truth between `SETTING_DEFAULTS` and `package.json` is mostly bridged by a schema-sync test (`tests/configDefaults.test.ts`), but that test only spot-checks 9 of ~20 keys (F048 lives in the gap).

The architecture is small and clean. Static-class-as-namespace is used throughout — appropriate for a VS Code extension where there's exactly one instance of everything per session and DI buys nothing.

## Findings

| ID | Status | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|--------|----------|-----------|----------|--------|-------------|----------------|
| F001–F033 | ✅ RESOLVED | (initial sweep) | — | — | — | All 33 initial findings resolved in commits `dd5873d`, `f20e44c`, `bad0603`, `0ca26e8`, `224f42b`, `4630e28`. | — |
| F034–F047 | ✅ RESOLVED | (repeat-run sweep) | — | — | — | All 14 second-order findings resolved in commits `ed04c3a`, `d5987c6`. | — |
| F048 | ✅ RESOLVED | Consistency rot | `src/utils/configService.ts:29` | Medium | S | `codestral.model` default mismatch: `'codestral-2405'` in `SETTING_DEFAULTS` vs `'codestral-latest'` in `package.json`. Schema-sync test only spot-checked 9 of ~20 keys. | **Shipped:** unified to `'codestral-latest'`. `SETTING_DEFAULTS` now exported; schema-sync test rewritten to walk **every** key (not 9) and compare against `package.json.default`. |
| F049 | ✅ RESOLVED | Documentation drift | `package.json:171`; `docs/configuration.md:138` | Low | S | Both referenced `.commitsage/language.json`; actual file is `translations.json`. | **Shipped:** both strings updated to `translations.json`. |
| F050 | ✅ RESOLVED | Documentation drift | `.commitsage.example:16` | Low | S | Referenced `gemini-1.5-flash`, no longer in the enum. | **Shipped:** changed to `"model": "auto"` (matches the F011 README fix). |
| F051 | ✅ RESOLVED | Dead code | `src/utils/logger.ts:36-38,57-59` | Low | S | `'Show Details'` branch in `Logger.showError` and `Logger.show()` were unreachable — no caller passed the action string. | **Shipped:** deleted both. ~10 LOC removed. |
| F052 | ✅ RESOLVED | Cancellation / UX | `src/services/commitWorkflow.ts`, `gitService.ts`, `gitBlameAnalyzer.ts`, `concurrency.ts` | Medium | M | `AbortSignal` not threaded through git ops during message generation; pressing Cancel only killed the LLM HTTP call, not the git fan-out. | **Shipped:** signal threaded through `executeGitCommand`, `getDiff`, `getChangedFiles`, `hasChanges`, `hasHead`, `getStagedDiff`/`getUnstagedDiff`/`getUntrackedDiff`/`getDeletedDiff`, `isSubmodule`, `analyzeChanges`. `commitWorkflow` propagates the existing signal. `mapLimit` now takes a signal and bails-fast: workers stop on abort. |
| F053 | ✅ RESOLVED | Dead code | `src/extension.ts:21-22` | Low | S | `validateGitExtension` called twice on activation: once explicitly, once via `initialize()`. | **Shipped:** removed the explicit call; `initialize()` covers it. |
| F054 | ✅ RESOLVED | Dead code | `src/utils/constants.ts:4-23` | Low | S | 10 of 22 keys in `errorMessages` were unreferenced. | **Shipped:** deleted the 10 unused keys (`commandExecution`, `generateCommitMessage`, `networkError`, `configError`, `gitError`, `invalidInput`, `noRepository`, `noWorkspace`, `fileNotCommitted`, `fileDeleted`). 9 referenced keys remain. |
| F055 | ✅ RESOLVED | Dead code | `gitService.ts:666`, `telemetryService.ts:11`, `templates/index.ts:13` | Low | S | 3 exported types had no external consumers (knip-flagged). | **Shipped:** dropped `export` from `ChangedFile`, `TelemetryEvent`, `CommitTemplate`. |
| F056 | ✅ RESOLVED | Dependency hygiene | `package.json` | Low | S | `terser-webpack-plugin` declared but unused — webpack 5 production mode auto-uses the bundled TerserPlugin. | **Shipped:** `npm uninstall terser-webpack-plugin`. Verified `npm run build:prod` still emits 415 KiB minified bundle. |
| F057 | ✅ RESOLVED | Build / CI hygiene | `.github/workflows/release.yml:43-44` | Low | S | `npm run compile` (webpack dev mode) ran before `npm run package`, then `vsce package` re-built in production via `vscode:prepublish`. Webpack ran twice. | **Shipped:** removed the redundant `Build` step. `vsce package` handles the prod build via `vscode:prepublish`. Saves ~30s CI per release. |
| F058 | ✅ RESOLVED | Type / contract | `tests/__mocks__/vscode.ts` | Low | S | Vscode mock lacked `getConfiguration().inspect()`, so production code calling `inspect<T>(configKey)` got an undefined return that bypassed the layered-settings logic in tests. | **Shipped:** added an `inspect()` shim returning `undefined` (so tests fall through to SETTING_DEFAULTS by default). Tests needing layered values mock `ConfigService` directly. |
| F059 | ✅ RESOLVED | Architectural / API surface | `src/services/apiKeyManager.ts` | Low | S | `requiresApiKey` was public but only used internally by `requiresKeyForCurrentConfig` after F038. | **Shipped:** removed `requiresApiKey`; inlined the `provider in API_KEY_CONFIGS` check into `requiresKeyForCurrentConfig`. |

## Top 5 — if you fix nothing else, fix these

All five items from the original ranking shipped in this sweep. Nothing outstanding.

## Quick wins

- [x] **F048**: codestral.model default unified; schema-sync test now walks every key.
- [x] **F049**: `language.json` → `translations.json` in `package.json:171` and `docs/configuration.md:138`.
- [x] **F050**: `.commitsage.example:16` → `"model": "auto"`.
- [x] **F051**: `'Show Details'` branch + `Logger.show()` deleted.
- [x] **F052**: `AbortSignal` threaded through all git operations + `mapLimit`.
- [x] **F053**: redundant `validateGitExtension` call removed from activation path.
- [x] **F054**: 10 unused `errorMessages` keys deleted.
- [x] **F055**: `export` dropped from `ChangedFile`, `TelemetryEvent`, `CommitTemplate`.
- [x] **F056**: `terser-webpack-plugin` uninstalled.
- [x] **F057**: redundant `Build` step removed from `release.yml`.
- [x] **F058**: `inspect()` shim added to `tests/__mocks__/vscode.ts`.
- [x] **F059**: `requiresApiKey` removed; check inlined into `requiresKeyForCurrentConfig`.

## Things that look bad but are actually fine

- **Empty `} catch {}` blocks at `gitService.ts:132,251,376` and `gitPath.ts:19`.** All four are intentional probe-style fallbacks (`hasRemotes`, `isSubmodule`, `hasHead`, octal-decode best-effort). Each returns a sensible default on failure rather than blowing up the parent operation. Deliberate.
- **`tsconfig.json:7-10` includes `"DOM"` in `lib`.** Looks wrong for a Node-only VS Code extension. It's documented (in F019's resolution comment) as needed because `@amplitude/analytics-core`'s `.d.ts` references browser globals (`IDBDatabase`, `RequestInfo`). Removing it breaks `tsc`. Leave.
- **8 commit-format files at 135–370 LOC each, ~2000 LOC of static translations.** Looks like a dead-code candidate that the `customLanguageService` LLM-translation path could replace. F013 explicitly considered and rejected this — the maintainer wants stable, deterministic templates for the static set, with LLM translation only as the fallback for `custom`. Leave.
- **Static-class-as-namespace pattern across all services.** Looks like Java idiom in TypeScript. But there's exactly one instance of everything per VS Code session, no testing benefit from instances, and DI buys nothing. F033 considered switching to module-level functions and decided the difference is cosmetic. Leave.
- **`mapLimit(items, 8, ...)` for git fan-out and blame analysis.** Looks like over-engineering for small changesets. But F007 documents the case (200-file changesets producing 400+ concurrent `git` subprocesses caused process-table pressure). For ≤8 files `mapLimit` is identical to `Promise.all`. Leave.
- **Old `geminicommit-2.4.3.vsix` / `2.5.0.vsix` / `2.5.2.vsix` files in repo root.** Looks like build artifacts that should be cleaned. They are gitignored (`*.vsix` in `.gitignore`) and only present in this developer's working tree. Not a tech-debt issue.
- **`process.env` access in `src/constants/apiKeys.ts:7`.** Looks like a leak vector. It's the contributor-override path that F041 explicitly chose: empty default, CI rewrites the file with the real key, contributors with a local `.env` get it injected via `dotenv-webpack`. Telemetry initialization short-circuits on the empty string. Documented at the top of the file.
- **`OpenAIService` always sends `max_tokens: options?.maxTokens ?? 1024` while Codestral/Ollama only send when `maxTokens` is explicit.** Looks like asymmetry. But `1024` is the F001 fix's chosen default for the OpenAI-shaped APIs that respect it; the others omit it because their server-side defaults are reasonable and not setting it lets users tune via provider config. Different APIs, different conventions. Leave.

## Open questions for the maintainer

- **`.commitsage.example` (committed, 630 bytes):** is this still serving a purpose now that the `Create Project Config` command + `docs/configuration.md` examples cover the same ground? If yes, it needs the F050 fix; if not, delete it.
- **`terser-webpack-plugin` (F056):** was this added for a planned custom Terser config that never landed, or is it just leftover? `webpack --mode production` ships TerserPlugin out of the box.
- **`TelemetryEvent` export (F055):** was this exported intentionally for downstream consumers (e.g. a future test that asserts event shape), or accidentally? If the former, leave; if the latter, drop the `export`.
- **The `Build` step in `release.yml` (F057):** was running `npm run compile` before `npm run package` deliberate (e.g. to fail fast on type errors before the more expensive prod build), or accidental? If fail-fast was the intent, replacing with `npm run typecheck` is cleaner — it's already a script.
- **`gemini-1.5-flash` in `.commitsage.example`:** should the file even reference a specific model, or should the example use `auto` (matching the F011 README fix)?
