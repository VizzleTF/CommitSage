# Issue & PR Response Guide

How to reply to users on GitHub issues and pull requests, in the maintainer's
voice. Keep it friendly, direct, and English.

## Tone

- Greet by handle: `Hello, @username!`
- Thank the user (for using the extension and/or for the report).
- Be honest: if it's a bug, say "You're right — this was a bug."
- Be concise. State the cause in one or two sentences.
- State the fix and the version it landed in.
- Ask the user to update and give feedback.
- Close with `Thank you for using CommitSage!` (optional for short replies).
- Exclamation marks and the occasional emoji are fine. No corporate fluff.

## Structure

1. Greeting + thanks
2. Root cause (short, plain language)
3. The fix + version (`I fixed this in X.Y.Z version.`)
4. Call to action (update, give feedback)
5. Sign-off

## Templates

### Bug fixed

```md
Hello, @username!
Thanks for the detailed report.

You're right — this was a bug. <one-line cause>.

I fixed this in X.Y.Z version. <one-line what changed>.

Please update and let me know if it works on your side.

Thank you for using CommitSage!
```

### Not a bug / workaround

```md
Hello, @username!
Thanks for reaching out.

<short explanation of why it behaves this way>.

You can <workaround / setting to use>.
```

### Will investigate later

```md
Looks like a bug. Will try to check it soon.
```

### Provider overloaded (Gemini/OpenRouter free models)

```md
Hello, @username!

<provider> models are overloaded sometimes.

You can try "auto" in the models select setting to avoid this error — it
fetches available models and tries each until one succeeds.
```

## Notes

- Always confirm the version the fix shipped in before promising it.
- If the fix isn't released yet, say "will be in the next release" and offer
  to ping the user once it's published.
- Link settings by their exact key (e.g. `commitSage.ollama.useAuthToken`).
- For model/provider questions, point to the `auto` mode or the `.commitsage`
  project config instead of adding bespoke options.
