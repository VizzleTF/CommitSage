# Testing

Commit Sage has two layers of automated tests: unit tests in vitest and end-to-end (E2E) tests in a real VS Code. CI runs both on every pull request, and both run locally.

## Test layers

### Unit tests: vitest

In-process tests of utilities and services, in `tests/*.test.ts`.

A minimal mock at `tests/__mocks__/vscode.ts` replaces the `vscode` API, so unit tests cannot exercise activation, command registration or anything that depends on the Git extension.

Use them for:

- pure logic: parsers, validators, retry math, prompt construction;
- provider request payloads (`tests/providerPayloads.test.ts`);
- configuration defaults and project config validation.

### E2E tests: `@vscode/test-electron` and mocha

E2E tests run the extension inside a headless VS Code with the built-in `vscode.git` extension. They live in `tests/e2e/suite/*.e2e.ts`.

Use them for anything that touches the `vscode` API, command registration, the Git extension or the full commit message flow.

## Run the tests locally

```bash
npm run test:unit      # vitest
npm run test:e2e       # E2E against the dev bundle; downloads VS Code on the first run
npm run test:e2e:vsix  # E2E against the packaged .vsix (production bundle)
npm test               # test:unit, then test:e2e
npm run verify         # typecheck, eslint, test:unit, test:e2e, test:e2e:vsix
```

On Linux without a display (CI, WSL, SSH), prefix the E2E scripts and `verify` with `xvfb-run -a`.

`pretest:e2e` compiles the suite with `tsc -p tests/e2e/tsconfig.e2e.json` and builds the bundle with `npm run compile` before VS Code starts.

`pretest:e2e:vsix` packages the extension to `.vscode-test/commitsage.vsix`, unpacks it to `.vscode-test/vsix/extension` and copies the compiled suite into that folder. The copy is required: VS Code gives each extension its own `vscode` API object by file path, so stubs on `vscode.window` reach the extension only when the tests live inside its folder.

The first E2E run downloads VS Code stable into `.vscode-test/` and caches it there.

### Run a single test

```bash
npm run test:e2e -- --grep "Auto-commit"
npm run test:e2e -- --grep "Multi-repository"
```

### Debug E2E failures

- `COMMITSAGE_E2E_KEEP=1 npm run test:e2e` keeps the temporary git repositories after teardown and logs their paths.
- The `vscode.git` log line `Repository not initialized` appears when VS Code shuts down a watcher. It is not a failure unless a test fails.

## E2E architecture

### Mock LLM server

`tests/e2e/helpers/mockLlmServer.ts` starts a `node:http` server on a random port. It answers in the OpenAI Chat Completions format, and in the Ollama format for paths that contain `/api/chat`.

```ts
const mock = new MockLlmServer();
const { baseUrl } = await mock.start();
// baseUrl → http://127.0.0.1:<PORT>/v1
await setProviderToMockOpenAI(baseUrl); // tests/e2e/helpers/settings.ts
```

Queue per-request responses for error scenarios. A request with no queued step gets a 200 with a default message.

```ts
mock.enqueue({ status: 429 }, { status: 429 }); // 1st and 2nd attempts fail, the 3rd gets the default 200
mock.enqueue({ status: 401 });                  // ApiKeyInvalidError → prompt for a new key
mock.enqueue({ delayMs: 5_000 });               // slow response for cancellation tests
mock.enqueue({ rawBody: 'not json' });          // malformed body
```

`mock.requests` holds the captured requests for assertions on the prompt or the `Authorization` header.

### Temporary git repositories

`tests/e2e/helpers/tempRepo.ts` creates throwaway repositories inside `tests/e2e/sampleWorkspace` and registers them with `vscode.git` through `api.openRepository`.

```ts
const repo = await makeTempRepo({ initialCommit: true });
await git(repo.path, 'add', 'README.md');
await vscode.commands.executeCommand('commitsage.generateCommitMessage');
await cleanupRepo(repo);
```

`cleanupRepo` calls `closeAllOpenRepos()`, which runs `git.close` for every repository open in `vscode.git`, then deletes the folder. Bare-remote scenarios (auto-push) pass `bareRemote: true`; `cleanupRepo` deletes the remote too.

### UI stubs

`tests/e2e/helpers/vscodeStubs.ts` wraps `sinon` so that a modal popup never blocks the run.

```ts
beforeEach(() => {
    installDefaultUiStubs({ inputBox: 'e2e-test-key' });
    // unstubbed showQuickPick resolves to undefined, showInputBox to 'e2e-test-key'
});

it('selects the second repo', () => {
    stubQuickPick({ label: '...', repository: realRepoB }); // overrides the default
});

afterEach(() => restoreStubs());
```

For cancellation tests, `stubWithProgressCancellable(50)` replaces `vscode.window.withProgress` with a version that fires the cancellation token after 50 ms.

### Workspace setup

`.vscode-test.mjs` copies `tests/e2e/sample.code-workspace` to `.vscode-test/e2e.code-workspace` and `@vscode/test-cli` opens the copy, because the tests write workspace settings into that file. The settings turn off Git auto-detection (`git.autoRepositoryDetection: false`, `git.openRepositoryInParentFolders: never`), so `vscode.git` sees only the repositories the tests open. Without them, the parent Commit Sage repository is also detected and every generation opens a repository QuickPick.

VS Code writes provider settings into this file during a run. `setProviderToMockOpenAI` overwrites `commitSage.openai.baseUrl` with the current mock port on every run.

## What the E2E suites cover

| Suite | Scenarios |
|---|---|
| `activation.e2e.ts` | extension activates; the commands in `EXPECTED_COMMANDS` and the settings view focus command are registered; `vscode.git` is available |
| `generateCommit.e2e.ts` | modified and staged file → message in the input box; untracked file auto-staged and committed; deleted file; staged-only mode ignores unstaged files |
| `multiRepo.e2e.ts` | two repositories in the workspace; the QuickPick stub routes generation to the chosen one |
| `autoCommit.e2e.ts` | real `git commit` when `autoCommit` is on; push to a bare remote when `autoPush` is on |
| `llmErrors.e2e.ts` | 429 retry chain; 401 prompts for a new key; a 400 rejecting `temperature` → retry without it |
| `cancellation.e2e.ts` | progress token cancellation aborts the request and prevents retries |

## What the E2E suites do not cover

The mock server cannot intercept providers without a `baseUrl` setting, because their endpoints are hard-coded. Only `openai`, `ollama` and `custom` have that setting. Unit tests in `tests/providerPayloads.test.ts` cover the request shape of the other providers.

## Add an E2E test

1. Create `tests/e2e/suite/<NAME>.e2e.ts`.
2. Copy the `before`/`after` hooks from `tests/e2e/suite/generateCommit.e2e.ts`. They activate the extension, start the mock server, point the `openai` provider at it and store an API key.
3. Call `installDefaultUiStubs({ inputBox: 'e2e-test-key' })` in `beforeEach`, so a UI path without a stub does not block the run.
4. Run `npm run test:e2e -- --grep "<DESCRIBE_TEXT>"` while you iterate.

## CI

The reusable workflow `.github/workflows/test.yml` runs the tests. `pr-check.yml` calls it for pull requests to `main`, `release.yml` for `v*` tags, and `security-release.yml` for Dependabot pull requests that change `package.json` or `package-lock.json` when its security check reports a critical advisory. On Node.js 22 it runs:

1. `npm ci`.
2. Writes a stub `src/constants/apiKeys.ts`; the real file is gitignored.
3. `npm run typecheck`.
4. `npx eslint 'src/**/*.ts'`.
5. `npm run test:unit`.
6. `npx tsc -p tests/e2e/tsconfig.e2e.json`.
7. Restores the `.vscode-test` cache.
8. `xvfb-run -a npm run test:e2e`.
9. `xvfb-run -a npm run test:e2e:vsix`.
