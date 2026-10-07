# Issue and PR response guide

How to reply to users on GitHub issues and pull requests in the maintainer's voice. Replies are in English.

## Rules

- Greet the user by handle: `Hello, @<USERNAME>!`
- Thank the user for using the extension or for the report.
- If it is a bug, say so: "You're right, this was a bug."
- State the cause in one sentence, in plain language.
- State the fix and the version it shipped in. Confirm the released version before you name it. If the fix is not released yet, say it will be in the next release and offer to ping the user when it is published.
- Ask the user to update and give feedback.
- Name settings by their exact key, for example `commitSage.ollama.useAuthToken`.
- For model or provider questions, point to the Gemini `auto` model mode or the `.commitsage` project config instead of adding a new option.
- Exclamation marks and an occasional emoji are fine. Leave out corporate phrasing.
- `Thank you for using CommitSage!` closes the reply; a short reply may skip it.

## Structure

1. Greeting and thanks
2. Cause
3. Fix and version: `I fixed this in <VERSION> version.`
4. Call to action: update, give feedback
5. Sign-off

## Templates

### Bug fixed

```md
Hello, @<USERNAME>!
Thanks for the detailed report.

You're right, this was a bug. <CAUSE>.

I fixed this in <VERSION> version. <WHAT_CHANGED>.

Please update and let me know if it works on your side.

Thank you for using CommitSage!
```

### Not a bug, with a workaround

```md
Hello, @<USERNAME>!
Thanks for reaching out.

<WHY_IT_BEHAVES_THIS_WAY>.

You can <WORKAROUND_OR_SETTING>. Please let me know if it works for you.

Thank you for using CommitSage!
```

### Will investigate later

```md
Hello, @<USERNAME>!
Thanks for the report. Looks like a bug. I will try to check it soon.
```

### Gemini models overloaded

```md
Hello, @<USERNAME>!
Thanks for the report.

Gemini models are overloaded sometimes.

You can set `commitSage.gemini.model` to "auto" to avoid this error. It fetches
the available models and tries each one until one succeeds. Please let me know
if it helps.

Thank you for using CommitSage!
```
