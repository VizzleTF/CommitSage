# Testing

CommitSage has two layers of automated tests. Both run in CI on every PR and can be run locally.

## Test layers

### Unit tests — `vitest`

Fast, in-process tests of utilities and services. Live in `tests/*.test.ts` (95+ tests, < 1s).

The `vscode` API is replaced by a minimal mock at `tests/__mocks__/vscode.ts`, so unit tests cannot exercise activation, command registration, or anything that depends on the Git extension.

Use them for:
- Pure logic (parsers, validators, retry math, prompt construction)
- Provider request payloads (`tests/providerPayloads.test.ts` covers all four)
- Configuration defaults and project-config validation

### End-to-end tests — `@vscode/test-electron` + `mocha`

Run the **packaged extension inside a real headless VS Code** with the real built-in `vscode.git`. Live in `tests/e2e/suite/*.e2e.ts` (13 tests, ~5s).

Use them for anything that touches `vscode` API surfaces, command registration, the Git extension, or the full commit-message flow.

## Running locally

```bash
npm run test:unit      # vitest only — fastest feedback loop
npm run test:e2e       # E2E only — downloads VS Code on first run
npm test               # both, sequentially
```

`pretest:e2e` automatically runs `tsc -p tests/e2e/tsconfig.e2e.json` and `npm run compile` (esbuild bundle) before launching test-electron.

The first E2E run downloads VS Code stable into `.vscode-test/` (~200 MB, cached). On macOS no extra setup is needed; Linux CI uses `xvfb-run`.

### Targeting a single test

```bash
npm run test:e2e -- --grep "auto-commit"
npm run test:e2e -- --grep "Multi-repository"
```

### Debugging E2E failures

- `COMMITSAGE_E2E_KEEP=1 npm run test:e2e` — keeps temporary git repos around after teardown; their paths are logged.
- The log line `Repository not initialized` from the `vscode.git` extension is normal noise when VS Code is winding down a watcher; ignore unless tests actually fail.
- Use F5 with `.vscode/launch.json` "Extension Tests" config for breakpoint debugging.

## E2E architecture

### Mock LLM server

`tests/e2e/helpers/mockLlmServer.ts` boots a `node:http` server on a random port. It impersonates the OpenAI Chat Completions endpoint (and Ollama on `/api/chat`).

```ts
const mock = new MockLlmServer();
const { baseUrl } = await mock.start();
// baseUrl → http://127.0.0.1:<port>/v1
// Configure CommitSage to point at it:
await vscode.workspace.getConfiguration('commitSage')
    .update('openai.baseUrl', baseUrl, vscode.ConfigurationTarget.Workspace);
```

Queue per-request behaviour for error scenarios:

```ts
mock.enqueue({ status: 429 }, { status: 429 });   // 1st & 2nd attempts fail; 3rd hits default 200
mock.enqueue({ status: 401 });                    // 401 → ApiKeyInvalidError → reprompt flow
mock.enqueue({ delayMs: 5_000 });                 // slow response — used for cancellation tests
mock.enqueue({ rawBody: 'not json' });            // malformed body
```

Captured requests are available as `mock.requests` for assertions on the prompt or `Authorization` header.

### Temporary git repositories

`tests/e2e/helpers/tempRepo.ts` creates throwaway repos **inside** `tests/e2e/sampleWorkspace`, registers them with `vscode.git` via `api.openRepository`, and closes them with `git.close` on teardown.

```ts
const repo = await makeTempRepo({ initialCommit: true });
// repo.path is auto-detected by vscode.git — no updateWorkspaceFolders calls.
await git(repo.path, 'add', 'README.md');
await vscode.commands.executeCommand('commitsage.generateCommitMessage');
await cleanupRepo(repo);   // closes the repo in vscode.git, then rm -rf
```

Bare-remote scenarios (auto-push) get `bareRemote: true`. The remote is also under `sampleWorkspace` and cleaned up automatically.

### UI stubs

`tests/e2e/helpers/vscodeStubs.ts` wraps `sinon` so that any modal popup never blocks the run.

```ts
beforeEach(() => {
    installDefaultUiStubs({ inputBox: 'e2e-test-key' });
    // Any unstubbed showQuickPick/showInputBox now resolves to undefined / 'e2e-test-key'
});

it('selects the second repo', () => {
    stubQuickPick({ label: '...', repository: realRepoB });   // overrides the default
    // ...
});

afterEach(() => restoreStubs());
```

For cancellation tests, `stubWithProgressCancellable(50)` replaces `vscode.window.withProgress` with a version that fires the cancellation token after 50 ms.

### Workspace setup

`tests/e2e/sample.code-workspace` is opened by `@vscode/test-cli`. The settings disable Git auto-detection (`git.autoRepositoryDetection: false`, `git.openRepositoryInParentFolders: never`) so only repos we explicitly open via `api.openRepository` show up — otherwise the parent CommitSage repo would always be picked up too and force a QuickPick.

VS Code rewrites this file with provider settings during a run; that's expected. The persisted `commitSage.openai.baseUrl` is overwritten on every test boot with the current mock port.

## What's covered

| Suite                       | Scenarios                                                                 |
|-----------------------------|---------------------------------------------------------------------------|
| `activation.e2e.ts`         | extension activates; all 10 contributed commands registered; `vscode.git` available |
| `generateCommit.e2e.ts`     | modified+staged → message in inputBox; untracked → auto-stage; deleted; staged-only ignores unstaged |
| `multiRepo.e2e.ts`          | 2 repos in workspace, QuickPick stub routes generation to the chosen one  |
| `autoCommit.e2e.ts`         | real `git commit` when `autoCommit=true`; push to bare remote when `autoPush=true` |
| `llmErrors.e2e.ts`          | 429 retry chain (3 attempts, ~3 s of backoff); 401 reprompt for new key   |
| `cancellation.e2e.ts`       | progress token cancellation aborts the in-flight fetch and prevents retries |

## What's NOT covered (and why)

- **Gemini and Codestral provider transport** — both use hard-coded URLs without a `baseUrl` setting, so the local mock server can't intercept them. Their request shapes are covered by `tests/providerPayloads.test.ts` (unit).
- **Smoke-installing the packaged `.vsix`** — E2E already runs the full extension; a separate `.vsix` install only matters for the release pipeline, not PRs.

## Adding a new E2E test

1. Create `tests/e2e/suite/<name>.e2e.ts`.
2. Boilerplate `before`/`after` from `tests/e2e/suite/generateCommit.e2e.ts` is the simplest template — it activates the extension, starts the mock server, sets the provider to mock-OpenAI, and seeds an API key.
3. Use `installDefaultUiStubs({ inputBox: 'e2e-test-key' })` in `beforeEach` so any forgotten UI path doesn't block the run.
4. `npm run test:e2e -- --grep "<your describe text>"` while iterating.

## CI

`.github/workflows/pr-check.yml` runs both layers on every PR:

1. `npm run test:unit` (vitest)
2. `tsc -p tests/e2e/tsconfig.e2e.json` (E2E compile)
3. `actions/cache` for `.vscode-test/` (avoids re-downloading VS Code)
4. `xvfb-run -a npm run test:e2e`

Total CI time after warm cache: ~1 min for the test job. If E2E starts dominating the build, split it into a separate job with `needs: [test]` and add a matrix over `os`.
