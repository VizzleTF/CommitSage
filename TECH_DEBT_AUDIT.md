# Tech Debt Audit — CommitSage

Generated: 2026-04-30
Repo size: ~5,580 LOC TypeScript across 41 files. VS Code extension, single module.
Tooling actually run: `tsc --noEmit`, `npm audit`, `git log/blame`, manual code reading.
Tooling not run (not installed, didn't auto-install per skill rules): `knip`, `madge --circular`, `depcheck`.

## Executive summary

- **Real correctness bug**: `OpenAIService` sends `maxTokens` (camelCase) instead of `max_tokens` to the OpenAI Chat Completions API, which silently drops the field. The 4096-token translation budget for `customLanguageService` is being ignored for OpenAI/Codestral/Ollama. (`src/services/openaiService.ts:48`, `src/services/codestralService.ts:35-38`, `src/services/ollamaService.ts:32-38`)
- **Real correctness bug**: `createProjectConfig` writes the legacy flat `.commitsage` file format, which `ConfigService.migrateProjectConfig()` immediately rewrites to `.commitsage/config.json` on next activation — and it writes `gemini-1.5-flash`, a model not in any current enum or README list. (`src/commands/createProjectConfig.ts:15,49`)
- **Real correctness bug**: `GitService.executeGitCommand` throws on any non-empty stderr regardless of git's exit code; many normal git commands (commit/add hooks, push progress) write to stderr on success and break this. (`src/services/gitService.ts:454-459`)
- **Security/privacy**: Gemini API keys are passed in the URL query string (`?key=…`), so they end up inside `axios` error messages and stack traces, which then flow into `Logger.error` and into the telemetry pipeline (only file paths are sanitized). (`src/services/geminiService.ts:42,82,140`, `src/utils/errorUtils.ts:8-15`)
- **No tests at all.** No `*.test.ts`, no `tests/` dir, no test runner in `package.json`. For a 5.5k-LOC extension that talks to four external APIs and parses git output, this is the single biggest debt category.
- **Cancellation token does not propagate** into HTTP calls. Users clicking "Cancel" only stops at coarse checkpoints; the in-flight `axios.post` to Gemini/OpenAI/Codestral/Ollama runs to completion. (`src/services/commitWorkflow.ts:35-43,148`)
- **Unbounded fan-out** in `commitWorkflow` and `gitService`: `Promise.all` over every changed file spawns one `git blame` and one `git diff` subprocess per file with no concurrency cap. (`src/services/commitWorkflow.ts:139-142`, `src/services/gitService.ts:257-274`)
- **Auto-commit silently runs `git add -A`** when there are no staged changes but there are untracked or deleted files, sweeping in files the user may not have wanted. (`src/services/gitService.ts:99-101`)
- **Documentation drift**: `CHANGELOG.md` stops at 2.2.25 (2025-06-21); `package.json` is at 2.5.2. README still references `gemini-2.0-flash` models that no longer appear in the package.json enum. Default ollama model is `llama3.2` in package.json but `mistral` in `ConfigService.getOllamaModel()`'s fallback. Russian and English comments are interleaved throughout services with no apparent rule.
- **Eight `npm audit` advisories** (all moderate, all transitive through `@vscode/vsce` / dependabot deps), all with `fixAvailable: true`. Worth a single sweep.

## Architectural mental model

CommitSage is a thin VS Code command that turns "user staged some changes" into "AI-generated commit message in the SCM input box."

The shape is straightforward and basically right for the size: `extension.ts` activates singleton services (`ConfigService`, `ApiKeyManager`, `Logger`, `TelemetryService`, `GitService`), then `registerCommands` wires three command handlers. The hot path is `CommitWorkflow.generateAndSetCommitMessage` → `GitService.getDiff` (shells out to `git`) + `GitBlameAnalyzer.analyzeChanges` per file → `PromptService.generatePrompt` (template + language) → `AIServiceFactory` dispatches by provider type to `Gemini|OpenAI|Codestral|Ollama` services, which all share `BaseAIService.handleHttpError` and `RetryUtils.handleGenerationError`. Cross-cutting: `Logger` (single output channel), `TelemetryService` (Amplitude, build-time-injected key via CI), retry/backoff in `RetryUtils`.

The two non-obvious things are (1) project-level config is read from `.commitsage/config.json` (a directory layout) but a one-shot migration silently moves any legacy flat `.commitsage` file into that directory the next time the extension activates, and (2) for `commitLanguage = custom`, `CustomLanguageService` *uses the configured AI provider itself* to translate the English commit-format template into the user's language and caches it in `.commitsage/translations.json`. That's a clever design but it's the place where the OpenAI `max_tokens` bug actually has user-visible impact, because translations are silently truncated.

This basically lines up with the README, with two divergences worth flagging: the `.commitsage` directory layout isn't described in the README (it still says "create a `.commitsage` file") and the `custom` language path isn't mentioned in either README or `docs/configuration.md` despite being one of the more interesting features.

## Status legend

- ✅ **Done** — fix shipped to `main`.
- ❌ **Won't do** — explicitly rejected by maintainer.
- ⏭ **Open** — not yet addressed.

PRs that closed the audit: `dd5873d` (PR #1), `f20e44c` (PR #3), `bad0603` (PR #4), `0ca26e8` (PR #5), `224f42b` (PR #6), `4630e28` (PR #7), and the wrap-up commit that closes F023/F024/F030.

## Findings

| ID | Status | Category | File:Line | Severity | Effort | Description | Recommendation |
|----|--------|----------|-----------|----------|--------|-------------|----------------|
| F001 | ✅ Done (PR #1) | Type/contract | `src/services/openaiService.ts:48` | Critical | S | Payload uses `maxTokens` (camelCase). OpenAI Chat Completions API expects `max_tokens` (snake_case) and silently ignores the unknown field. Default 1024 cap from this code is therefore inactive; server defaults apply (varies by model). The bug is amplified for translations (`customLanguageService.ts:118` requests 4096 tokens — also dropped). | Rename to `max_tokens`. Add an integration smoke test that asserts the field is honored. |
| F002 | ✅ Done (PR #1) | Architectural / Consistency | `src/commands/createProjectConfig.ts:15-49`, `src/utils/configService.ts:19-40` | High | S | `createProjectConfig` writes the legacy flat-file `.commitsage` format containing `gemini-1.5-flash` (not in `package.json` enum, lines 240-248). Next activation, `migrateProjectConfig` deletes the file and rewrites it as `.commitsage/config.json`. So the user's freshly-created file mutates underneath them and references an invalid model. | Create directly into `.commitsage/config.json`; pick a default model from the current enum (`auto`). |
| F003 | ✅ Done (PR #1) | Error handling | `src/services/gitService.ts:454-459` | High | S | `executeGitCommand` treats any non-empty stderr as failure even when `git` exited 0. This breaks against legitimate informational stderr (commit-msg hooks, partial-clone hints, "warning: …" lines). Errors here propagate as plain `Error(stderr)`. | Use the exit code from `execGit` (already captured) as the only failure signal; surface stderr only on non-zero. |
| F004 | ✅ Done (PR #3) | Cancellation / UX | `src/services/commitWorkflow.ts:35-43,148`; `src/services/gitService.ts:537-562` | High | M | The `CancellationToken` from `vscode.window.withProgress` is checked at three coarse points but is not threaded into `AIService.generateCommitMessage` or any `axios.post`. Once a request is dispatched, "Cancel" does nothing until the network call returns. Same for `execGit` — a hung git subprocess can't be cancelled. | Pass the token down; create an `AbortController` per axios call and abort on cancellation. For `execGit`, kill the spawned process on token fire. |
| F005 | ✅ Done (PR #1) | Security / privacy | `src/services/geminiService.ts:42,82,140`; `src/utils/errorUtils.ts:8-15` | High | S | Gemini API keys are sent as URL query params (`?key=…`). Axios includes the URL in error stack traces; `Logger.error(toError(err))` and `sanitizeErrorForTelemetry` only redact filesystem paths, not URL secrets. A Gemini error therefore leaks the key into the output channel and into Amplitude telemetry. | Send the key in the `x-goog-api-key` request header instead. Extend `sanitizeErrorForTelemetry` to redact `key=`, `Authorization:`, and `Bearer …`. |
| F006 | ✅ Done (PR #1) | Test debt | repo-wide | High | L | Zero tests. No runner declared in `package.json`, no `*.test.ts` / `*.spec.ts` files. Logic that needs coverage: `unquoteGitPath` (octal decoding edge cases), `parseChangedLines`/`analyzeBlameInfo` (off-by-one risk), `ConfigService.getNestedProjectValue`, `removeThinkTags`, `BaseAIService.handleHttpError`, all four provider services' response-shape parsing. | Add `vitest`. Start with pure-function tests for the textProcessing/parsing layer; mock `axios` for provider tests. **Shipped:** vitest harness + 65 tests across 7 files, including F001/F005/F009/F025 regression guards. |
| F007 | ✅ Done (PR #4) | Performance | `src/services/commitWorkflow.ts:139-142`; `src/services/gitService.ts:257-274` | High | M | `Promise.all(files.map(...))` fans out one `git blame --line-porcelain` and one `git diff -- <file>` subprocess per changed file with no cap. For a 200-file changeset this is 400+ concurrent `git` processes. Risk of process-table exhaustion and surprise CPU spikes. | Wrap with a small concurrency limiter (e.g. 8–16). Or batch diffs into a single `git diff -- file1 file2 …` call with a header parser. |
| F008 | ✅ Done (PR #1) | Behavior / safety | `src/services/gitService.ts:99-101` | High | S | When `autoCommit` is on and there are no staged changes but there are untracked or deleted files, the code runs `git add -A`, sweeping in *every* untracked file in the working tree (including caches, .env files saved into the workspace, etc.). | At minimum, add only the previously-detected changed/deleted files explicitly (`git add -- f1 f2 …`). Even better: refuse to auto-commit if nothing is staged. |
| F009 | ✅ Done (PR #4) | Type/contract | `src/services/codestralService.ts:29,35-38`; `src/services/ollamaService.ts:26,32-38` | Medium | S | Both services declare `_options?: GenerateOptions` with the leading underscore (intentionally unused) and never apply `maxTokens` to the payload. Translation calls in `customLanguageService.ts:118` request `maxTokens: 4096` → silently dropped for these providers, leading to truncated translations. | Either honor the option (Codestral: `max_tokens`; Ollama: `options.num_predict`) or document it as Gemini-only and remove the unused param. |
| F010 | ✅ Done (PR #5) | Doc drift | `CHANGELOG.md:10` vs `package.json:6` | Medium | S | `CHANGELOG.md` last entry is 2.2.25 (2025-06-21); current version is 2.5.2. ~10 months / dozens of releases undocumented. | Either start populating it again, or delete it and switch to GitHub Releases as the source of truth. **Shipped:** removed `CHANGELOG.md`; release notes live on GitHub Releases. |
| F011 | ✅ Done (PR #5) | Doc drift | `README.md:39`, `package.json:240-248` | Medium | S | README lists `gemini-2.0-flash`, `gemini-2.0-flash-001`, `gemini-2.0-flash-lite` etc. as model options. The actual `package.json` enum has `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`, `gemini-2.5-pro`/`flash`/`flash-lite` and no 2.0 entries. | Regenerate the README list from `package.json` or remove it (since `auto` is the default anyway). |
| F012 | ✅ Done (PR #5) | Consistency rot | `src/utils/configService.ts:316-318` | Medium | S | `getOllamaModel` defaults to `mistral` when the package.json schema default is `llama3.2`. The fallback is unreachable in normal use but represents drifted state. Also: `getOllamaBaseUrl` has the right default (`http://localhost:11434`). | Make defaults match (`llama3.2`) or extract them to a single constant table. |
| F013 | ❌ Won't do | Architectural decay | `src/templates/formats/*.ts` | Medium | M | 8 format files, ~135–370 LOC each, ~2,000 LOC total. Each is a dictionary of 9 hand-translated language strings. Adding a language requires editing all 8 files; the format authors have to be linguists. The `customLanguageService` LLM-translation path makes the case for shipping only English (or English + one anchor language) and translating on demand, *which the codebase already supports*. | Consider keeping only `english` and one anchor (`russian`) as static; lazily translate the rest at first use via the same path that already handles `custom`. **Rejected:** maintainer wants the static translations to remain. |
| F014 | ✅ Done (PR #6) | Telemetry hygiene | `src/services/telemetryService.ts:232-245`; `src/extension.ts:43-45` | Medium | S | `dispose()` does not await `processEventQueue()`. `flush()` is awaited from `deactivate`, but if a new event is queued between `flush()` returning and `dispose()` running it is lost. Also, when the queue overflows (`queueEvent` line 117) events are silently dropped. | Make `dispose()` await; or rely on `flush()` and don't kick off another async drain in `dispose`. |
| F015 | ✅ Done (PR #7) | Type/contract | `src/utils/configService.ts:159-172` | Medium | S | `getNestedProjectValue` walks a nested object using `current[section] as Record<string, unknown>` at every step. If the project config has a primitive at a parent path (e.g. `commit: false`), the cast lies and `section in current` will throw or return wrong results. No schema validation runs against `.commitsage/config.json`. | Validate the project config against a schema (e.g. zod or a hand-rolled `validateProjectConfig`) once at load and cache the validated object. |
| F016 | ✅ Done (PR #7) | Architectural decay | `src/utils/configService.ts:210-338` | Medium | S | 18 nearly-identical static getters (`getGeminiModel`, `getCommitLanguage`, etc.) that do nothing but call `getConfig`. Each new setting requires a new getter. | Replace with a single typed `get<K extends keyof Settings>(key: K)`-style accessor backed by a settings schema. |
| F017 | ✅ Done (PR #6) | Consistency rot | `src/services/gitService.ts` (double-quotes) vs every other service (single quotes) | Low | S | Visible mixed style. Prettier or an ESLint quote rule isn't configured. | Add `quotes: ['error', 'single']` to ESLint config or run Prettier across `src/`. |
| F018 | ✅ Done (PR #6) | Consistency rot | `src/services/aiServiceFactory.ts:7-9,17-19,29-31`; `src/services/codestralService.ts:20-21,55,60`; `src/services/openaiService.ts:27-28,68,73`; `src/services/ollamaService.ts:17-18,60`; `src/utils/retryUtils.ts:5,11,24,32,39`; `src/utils/httpUtils.ts:2,8,35` | Low | S | Russian-language comments (e.g. "AI сервис для работы с локальным Ollama API", "Универсальный метод") interleaved with English in the same files. Confusing for non-Russian-speaking contributors. | Pick one language for code comments. The README is bilingual; the source need not be. |
| F019 | ✅ Done (PR #6) | Type drift | `tsconfig.json:4`; `eslint.config.mjs:14`; `tsconfig.json:5,8` | Low | S | `moduleResolution: "node10"` is deprecated by TS6+ (`tsc` already warns). `eslint.config.mjs` declares `ecmaVersion: 2020` while `tsconfig.json` targets ES2022. `lib: ["ES2022", "DOM"]` includes DOM globals in a Node-targeted VS Code extension, allowing accidental `document`/`window` references. | `moduleResolution: "node16"` or `"bundler"`; align ESLint `ecmaVersion: 2022`; drop `"DOM"` from `lib`. **Done:** moved to `node16` + `module: "node16"`; ESLint `ecmaVersion: 2022`. **DOM kept** in `lib` because `@amplitude/analytics-core` exposes browser globals (IDBDatabase, RequestInfo, …) in its `.d.ts`. |
| F020 | ✅ Done (PR #6) | Dependency hygiene | `npm audit` output | Low | S | 8 moderate advisories (`@azure/identity`, `@azure/msal-node`, `brace-expansion`, `uuid`, etc.) — all transitive through `@vscode/vsce`, all `fixAvailable: true`. None ship in the extension bundle. | `npm audit fix` to satisfy dependabot; document that they are dev-only. |
| F021 | ✅ Done (PR #5) | Security hygiene | `src/utils/apiKeyValidator.ts:23` | Low | S | OpenAI key validator hard-codes `sk-` prefix. README explicitly advertises "OpenAI compatible providers" (Azure, OpenRouter, etc.) where keys do *not* start with `sk-`. Validator will reject valid keys for those providers. | Remove the `sk-` check, keep `emptyKey` and `invalidChars` only. |
| F022 | ✅ Done (PR #3) | Resource hygiene | `src/services/gitService.ts:537-562` | Low | M | `execGit` `spawn`s `git` with no timeout. If git prompts for credentials (e.g. on `pushChanges` over HTTPS without a credential helper), the subprocess hangs forever and the progress notification spins. | Inherit `commitSage.apiRequestTimeout` (already a setting), kill the child after timeout, and pass `GIT_TERMINAL_PROMPT=0` in the env. |
| F023 | ✅ Done (final PR) | Resource hygiene | `src/services/gitService.ts:546-548,550-552` | Low | S | `executeGitCommand` accumulates unbounded stdout/stderr buffers as JS strings. A diff over a huge generated file can eat hundreds of MB before the later `MAX_DIFF_LENGTH=100000` truncation in `aiService.ts:12` kicks in. | Cap accumulated stdout at, say, `MAX_DIFF_LENGTH * 2` and short-circuit when exceeded. **Shipped:** `GIT_OUTPUT_BUFFER_CAP = 200_000`, kill subprocess on overflow, downstream truncation handles the rest. |
| F024 | ✅ Done (final PR) | Error handling | `src/services/gitService.ts:230` | Low | S | `getDiff` re-wraps non-`NoChangesDetectedError` errors with a generic `new Error(\`Failed to get diff: ${msg}\`, { cause })`. Caller checks (`commitWorkflow`, telemetry) rely on `error.constructor.name` for `errorType` — original type info is lost. | Either preserve the original error or set `name`/`cause` so telemetry buckets stay meaningful. **Shipped:** mutate `original.message`, re-throw the original error so `error.constructor.name` survives. |
| F025 | ✅ Done (PR #4) | Correctness (low risk) | `src/services/gitBlameAnalyzer.ts:73-82,164-169` | Low | M | `parseBlameOutput` only pushes a `BlameInfo` when *all* of `author/email/date/timestamp/line` are populated. Then `analyzeBlameInfo` uses array index `+ 1` as the file line number. If `--line-porcelain` ever outputs a metadata-incomplete entry (binary lines, certain merge cases), indices drift silently and blame credits the wrong line/author. | Track the actual line number in `parseBlameOutput` (it's available right before the `\t` line via the SHA-line: `<sha> <orig> <final> <count>`). |
| F026 | ✅ Done (PR #6) | Architectural / consistency | `src/services/openaiService.ts:111-114` vs other extractors | Low | S | Three of four AI services use `BaseAIService.extractAndValidateMessage(content, name)`; OpenAI uniquely throws `OpenAIError` and then calls `BaseAIService.validateCommitMessage`. No reason for the asymmetry. | Use `BaseAIService.extractAndValidateMessage(content, 'OpenAI')`; delete `OpenAIError` (only used here). |
| F027 | ✅ Done (PR #6) | Consistency rot | `src/services/gitService.ts:417-419` | Low | S | `git status --porcelain` filter: `line.includes("Subproject commit") || line.includes("Entering")`. These strings come from `git submodule status`, not `git status --porcelain`, which represents submodules with mode 160000 / `M` plus `--ignore-submodules` semantics. The branch is dead. | Delete the filter or replace with proper submodule-mode handling using `git ls-files --stage`. |
| F028 | ✅ Done (PR #6) | Performance | `src/services/customLanguageService.ts:80,33` | Low | S | `writeFileSync` and `mkdirSync` on the extension's hot path block the event loop. They run on first translation (one-time per `(format, language)` pair) so impact is small, but the rest of the codebase uses `fs.promises`. | Switch to `fs.promises.writeFile` / `mkdir`. |
| F029 | ✅ Done (PR #5) | Correctness | `src/utils/configService.ts:108-109` | Low | S | `getProjectRootPath` returns only `workspaceFolders[0]`. In a multi-root workspace the user could have `.commitsage/config.json` only in folder #2, and the extension would silently miss it. | Resolve relative to the active editor / selected SCM repo when available; document the limitation otherwise. |
| F030 | ✅ Done (final PR) | Doc drift | `README.md:152-158` | Low | S | "Press `Cmd+G` (Mac) / `Ctrl+G` (Windows/Linux)" — the `package.json` keybinding is gated on `when: scmProvider == git`, which is only true when the SCM view is focused; the keybinding does not fire from a normal editor. Users have hit this. | Either broaden the `when` clause or update the doc to say "in the Source Control view". **Shipped:** README updated to instruct users to open the SCM view first; also points to the Command Palette as a global fallback. |
| F031 | ✅ Done (PR #7) | Architectural | `src/services/gitService.ts:294-364` | Low | M | Hand-rolled construction of `diff --git` headers / hunks for untracked and deleted files, including a manual blob-SHA1 calculation for untracked. Brittle and easy to break (`getDeletedDiff` doesn't compute a hash where `getUntrackedDiff` does, etc.). | Use `git diff --no-index /dev/null <file>` for untracked and `git diff -- <file>` for deleted; let git format the patch. |
| F032 | ✅ Done (PR #5) | Doc drift | `docs/` | Low | S | Several documented file paths refer to a `.commitsage` *file* (legacy) but `.commitsage/config.json` is the actual on-disk layout post-migration. (`README.md:107,115,229,237`, `docs/custom-language.md` likely affected.) | Sweep `docs/` and the README to use the directory form. |
| F033 | ✅ Done (PR #7) | Inconsistent abstraction | `src/services/baseAIService.ts:14-19` | Low | S | `extractAndValidateMessage` and `validateCommitMessage` exist as static methods on a class with no instance state; the class is used as a namespace. Used inconsistently (see F026). | Either keep the namespace pattern uniformly or switch to module-level functions. |

## Top 5 — if you fix nothing else, fix these

1. **F001 — `maxTokens` → `max_tokens` in OpenAI payload.**
   Diff sketch:
   ```ts
   // src/services/openaiService.ts:44-49
   const payload = {
       model,
       messages: [{ role: "user", content: prompt }],
       temperature: 0.7,
   -   maxTokens: options?.maxTokens ?? 1024
   +   max_tokens: options?.maxTokens ?? 1024
   };
   ```
   Add a one-liner test that snapshots the request body. While there, audit the other providers: Codestral takes `max_tokens`, Ollama takes `options.num_predict`. F009 covers the parallel fix.

2. **F004 — Thread `CancellationToken` into HTTP and git calls.**
   Add `signal?: AbortSignal` to `GenerateOptions`, derive an `AbortController` from the token in `commitWorkflow.executeWithProgress`, and pass `signal` into every `axios.post`/`axios.get` and (for `execGit`) `process.kill('SIGTERM')` on `signal.aborted`. The current "check then act" pattern at three call sites is not real cancellation.

3. **F005 — Stop sending the Gemini key in the URL.**
   ```ts
   // src/services/geminiService.ts (representative)
   - const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
   - const response = await axios.post<GeminiResponse>(apiUrl, payload, requestConfig);
   + const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
   + const response = await axios.post<GeminiResponse>(apiUrl, payload, {
   +   ...requestConfig,
   +   headers: { ...requestConfig.headers, 'x-goog-api-key': apiKey },
   + });
   ```
   And in `errorUtils.sanitizeErrorForTelemetry`, redact `key=…`, `Bearer …`, and `Authorization:` patterns alongside file paths. This is one small file plus a couple of url-builders.

4. **F002 — Make `createProjectConfig` write the directory layout.**
   ```ts
   // src/commands/createProjectConfig.ts
   - const configPath = path.join(workspaceFolder.uri.fsPath, '.commitsage');
   + const configDir = path.join(workspaceFolder.uri.fsPath, '.commitsage');
   + const configPath = path.join(configDir, 'config.json');
   + await fs.promises.mkdir(configDir, { recursive: true });
   ```
   And replace `gemini-1.5-flash` with `auto` (or any value from the `package.json` enum).

5. **F006 — Land a tiny test harness.**
   `npm i -D vitest @vitest/coverage-v8`, add `"test": "vitest"`, ship a first wave that covers the pure functions at risk of silent regression: `unquoteGitPath`, `removeThinkTags`, `parseChangedLines`/`analyzeBlameInfo`, `BaseAIService.handleHttpError` for each status code, and a single mock-axios test per provider that asserts request shape (this would have caught F001 immediately). Don't aim for 100% coverage; aim for the parsing/transformation layer.

## Quick wins (low effort × medium+ severity)

- [ ] **F001** Rename `maxTokens` → `max_tokens` in `openaiService.ts:48`.
- [ ] **F002** Have `createProjectConfig` create `.commitsage/config.json` directly; replace invalid `gemini-1.5-flash` default with `auto`.
- [ ] **F003** Use exit code (already captured in `execGit`) as the only failure signal in `executeGitCommand`.
- [ ] **F005** Move Gemini key from URL to `x-goog-api-key` header; extend `sanitizeErrorForTelemetry` to scrub URL keys and `Bearer …`.
- [ ] **F008** In `commitChanges`, replace `git add -A` with `git add -- <files>` over the previously-detected change set.
- [ ] **F010** Remove `CHANGELOG.md` (defer to GitHub Releases) or restart populating it.
- [ ] **F011** Regenerate README's Gemini model list from `package.json` enum, or drop the list since `auto` is default.
- [ ] **F012** Make `ConfigService.getOllamaModel` default match `package.json` (`llama3.2`).
- [ ] **F019** Set `moduleResolution: "node16"` (or `"bundler"`); align ESLint `ecmaVersion: 2022`; remove `"DOM"` from `tsconfig` `lib`.
- [ ] **F020** `npm audit fix` to clear the moderate advisories in dev deps.
- [ ] **F021** Drop the `sk-` prefix check in `validateOpenAIApiKey`.
- [ ] **F026** Use `BaseAIService.extractAndValidateMessage` in `OpenAIService.extractCommitMessage`; delete `OpenAIError`.
- [ ] **F027** Delete the dead "Subproject commit"/"Entering" filter in `getChangedFiles`.

## Things that look bad but are actually fine

- **`AMPLITUDE_API_KEY = ''` in `src/constants/apiKeys.ts:1` looks like a hardcoded secret stub.** It's not. The file is gitignored (`.gitignore:13`), and `.github/workflows/release.yml:38-41` overwrites it with the secret at build time. The empty default is the correct local-dev fallback, and `telemetryService.ts:56-58` short-circuits on it. Leave alone.
- **`webpack.config.js` includes `dotenv-webpack` even though `apiKeys.ts` isn't read from `process.env`.** Tempting to delete, but it's harmless dead-weight in dev builds, and removing it would break any local override-via-`.env` workflow contributors might have. The CI flow doesn't depend on it. Marginal call; leaving it alone is fine.
- **`MAX_DIFF_LENGTH = 100000` (`aiService.ts:12`) seems arbitrary.** It is, but it's at roughly the right order of magnitude for current LLM context windows and the truncation is communicated to the model with `\n...(truncated)`. Tuning it without telemetry on actual diff-size distributions would be guessing. Leave until F006 lands and you can measure.
- **`GeminiService.getAvailableModels` falls back to a hardcoded list when the models API fails (`geminiService.ts:57-62`).** This is duplication with `package.json`, but the fallback is "Gemini's models endpoint is down or the key is bad." A static fallback is better than blowing up. The duplication is real (F011 covers the README side) but the fallback list itself is pragmatic. Leave.
- **`Promise.all` over `analyzeChanges` for changed files (F007 above).** Flagged as Medium not Low because for typical 1–10-file changesets this is fine, and the fan-out only bites at >50 files in a single commit. If you don't see large-changeset bug reports, this can stay.
- **Russian-language comments throughout services (F018).** Stylistic only — flagged because mixed languages signal that the codebase has had multiple authors with different conventions and no agreed-on standard, but the comments themselves are mostly redundant ("Универсальный метод") and removing them would be cleaner than translating them.
- **The `EnvironmentUtils.isWebExtension` / `getEnvironmentType` abstraction (`src/utils/environmentUtils.ts`) when this extension is not actually shipped as a web extension.** Only used for telemetry tagging. Cheap, harmless, leave it.

## Open questions for the maintainer

- Is the lack of tests intentional (extension is small, manual QA covers it) or is it a "haven't gotten to it yet" thing? The right severity of F006 depends on this.
- Was the legacy `.commitsage` flat-file format ever actually shipped to users in production, or was the migration code added speculatively? If no one is on the legacy path, the migration in `configService.ts:19-40` and the validation branch in `settingsValidator.ts:28-38` are dead and can be deleted.
- Is the `custom` commit-language feature documented anywhere user-facing? It's referenced in `commit.customLanguageName` description in `package.json:171-172` but nowhere in the README. Hidden feature?
- The `Auto Push` flow does `git push` with no remote/branch args (`gitService.ts:146`). Was there an intentional decision to always push the current branch to its tracking remote, or is multi-remote / detached-HEAD support a future thing?
- The `keybindings` `when: scmProvider == git` (`package.json:120`) makes the Cmd+G/Ctrl+G shortcut only fire when the SCM view is focused, which contradicts the README's framing. Intentional (avoid stomping on Find-Next) or oversight?
- `src/constants/apiKeys.ts` is gitignored *and* present in the working tree as `AMPLITUDE_API_KEY = ''`. Is the working-tree copy left there intentionally as a stub for local builds, or is it leftover from when the file was committed?
