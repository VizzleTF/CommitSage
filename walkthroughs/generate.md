## Generate your first commit message

Stage some changes, then start generation in one of these ways:

- Click the **Commit Sage** icon in the Source Control header.
- Press <kbd>Ctrl</kbd>+<kbd>G</kbd> (<kbd>⌘</kbd>+<kbd>G</kbd> on macOS) in the Source Control view.
- Run `Commit Sage: Generate Commit Message` from the Command Palette.

The message appears in the Source Control input box. Set the format with `commitSage.commit.commitFormat` and the language with `commitSage.commit.commitLanguage`.

To commit and push without a click, enable `commitSage.commit.autoCommit` and `commitSage.commit.autoPush`. `autoPush` works only together with `autoCommit`. In an untrusted workspace, Commit Sage skips auto-commit.
