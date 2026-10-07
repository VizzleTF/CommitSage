# Releasing

A `v*` tag pushed to `main` starts `.github/workflows/release.yml`. The workflow runs the tests, packages the `.vsix`, writes release notes with Gemini, creates the GitHub release, publishes to the VS Code Marketplace and Open VSX, and posts to Telegram.

## Steps

1. On the feature branch, run the full check:

   ```bash
   xvfb-run -a npm run verify   # drop xvfb-run on a machine with a display
   ```

2. Bump the version in `package.json` and `package-lock.json`, then commit:

   ```bash
   npm version patch --no-git-tag-version   # or minor / major
   git commit -am "chore(release): bump version to X.Y.Z"
   ```

3. Open the pull request and merge it into `main`.

4. Tag the merge commit on `main`:

   ```bash
   git switch main && git pull --ff-only
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

5. Watch the workflow until it passes:

   ```bash
   gh run list --workflow release.yml --limit 1
   gh run watch <run-id> --exit-status
   ```

6. Confirm both marketplaces serve the new version:

   ```bash
   npx -y @vscode/vsce show VizzleTF.geminicommit --json | jq -r '.versions[0].version'
   curl -s https://open-vsx.org/api/VizzleTF/geminicommit | jq -r .version
   ```

   Both stores lag the workflow by a few minutes. Open VSX usually updates first.

Reply on the related issues only after step 6 shows the new version in both stores. The reply rules are in [issue-response-guide.md](issue-response-guide.md).

## Security auto-release

`.github/workflows/security-release.yml` runs on Dependabot pull requests that change `package.json` or `package-lock.json`. When `npm audit` reports a critical advisory, the workflow bumps the patch version and opens a pull request from the `security-patch-release` branch. After the merge, continue from step 4.
