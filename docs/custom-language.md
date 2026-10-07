# Set up a custom commit language

Use a custom language when Commit Sage has no built-in template for the language you want. The built-in languages are English, Russian, Chinese, Japanese, Korean, German, French, Spanish and Portuguese.

Prerequisites: a configured provider with a working API key. Setup: [providers.md](providers.md).

## Steps

1. Set `commitSage.commit.commitLanguage` to `custom`.
2. Set `commitSage.commit.customLanguageName` to the language name, for example `Ukrainian`.
3. Generate a commit message.

To set the language for one project only, put both keys in `.commitsage/config.json`:

```json
{
  "commit": {
    "commitLanguage": "custom",
    "customLanguageName": "Ukrainian"
  }
}
```

## Verification

The first generation shows the progress message `Translating commit format to <LANGUAGE>...`. After it, `.commitsage/translations.json` holds an entry for the language and the current format, and the message is in that language.

## How the translation works

Commit Sage asks the configured provider to translate the English template of the current `commitSage.commit.commitFormat`. Commit type names, emoji codes and format patterns stay in English. The result is cached, and later generations read the cache without a translation request.

- The cache key is the language name, case-sensitive: `Ukrainian` and `ukrainian` are separate entries.
- Each language entry holds one template per format. A new format adds a key under the existing language.
- A missing entry is translated again. To redo a translation, delete its entry or the whole file.
- If `customLanguageName` is empty, the English template is used and nothing is translated.
- With `useCustomInstructions` on and non-empty `customInstructions`, the prompt comes from `customInstructions` and nothing is translated, whatever the format. With `commitFormat` set to `custom` and without `useCustomInstructions`, the conventional template is translated and cached under the `custom` key.

## Cache file

The cache is `.commitsage/translations.json` in the project root. Commit it to share translations with your team.

```json
{
  "Ukrainian": {
    "conventional": "<TRANSLATED_TEMPLATE>",
    "angular": "<TRANSLATED_TEMPLATE>"
  }
}
```

## If it did not work

See [troubleshooting.md](troubleshooting.md). Setting details: [configuration.md](configuration.md).
