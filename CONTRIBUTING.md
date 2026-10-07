# Contributing to Commit Sage

This page shows how to set up a checkout, check a change and open a pull request.

## Set up

Use Node.js 22 with its bundled npm 10, the versions CI uses. `package-lock.json` is generated with npm 10; a lock file rewritten by npm 11 breaks `npm ci` in CI.

1. Fork the repository on GitHub and clone your fork:

   ```bash
   git clone https://github.com/<YOUR_USERNAME>/CommitSage.git
   cd CommitSage
   ```

2. Install the dependencies from the lock file:

   ```bash
   npm ci
   ```

3. Create `src/constants/apiKeys.ts`. The file is gitignored, and the build, type check and lint fail without it. An empty key turns telemetry off.

   ```bash
   mkdir -p src/constants
   echo "export const AMPLITUDE_API_KEY = '';" > src/constants/apiKeys.ts
   ```

4. Create a branch:

   ```bash
   git checkout -b <BRANCH_NAME>
   ```

## Develop

- `npm run compile` builds the bundle in `dist/` once with esbuild. It does not type-check.
- `npm run watch` rebuilds the bundle on every change.
- To open an Extension Development Host, start the `Run Extension` launch configuration. It runs `npm run compile` first.

## Check a change before the pull request

```bash
npm run verify      # typecheck, eslint, unit tests, E2E against the dev bundle and the packaged .vsix
```

On Linux without a display, run `xvfb-run -a npm run verify`. Test layers, single-test runs and the CI steps are in [docs/testing.md](docs/testing.md).

## Commit messages

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `<TYPE>(<SCOPE>): <SUMMARY>`, for example `fix(openai-compat): adapt payload when model rejects max_tokens or temperature`.

## Pull requests

Push the branch to your fork and open a pull request against `main`. A pull request:

- holds one change;
- adds or updates tests for changed behavior;
- updates `README.md` and the pages in `docs/` that describe changed behavior;
- describes what changed and why.

## Contributor guides

- [Add a language](docs/adding-languages.md)
- [Add a commit format](docs/adding-formats.md)
- [Add an AI provider](docs/adding-providers.md)
- [Testing](docs/testing.md)

## Questions

Ask in [GitHub Issues](https://github.com/VizzleTF/CommitSage/issues) or in the [Telegram group](https://t.me/gemini_commit).
