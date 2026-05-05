## Generate your first commit message

Stage some changes and trigger generation any of these ways:

- Click the **Commit Sage** icon in the SCM panel header.
- Press <kbd>Ctrl</kbd>+<kbd>G</kbd> (<kbd>⌘</kbd>+<kbd>G</kbd> on macOS) while focused on the SCM view.
- Run `Commit Sage: Generate Commit Message` from the Command Palette.

The generated message is written into the SCM input box. Tweak the format under `commitSage.commit.commitFormat` (Conventional, Angular, Karma, …) and the language under `commitSage.commit.commitLanguage`.

Want auto-commit and auto-push? Toggle `commitSage.commit.autoCommit` and `commitSage.commit.autoPush` — note that `autoPush` requires `autoCommit`.
