# Custom Language

CommitSage supports generating commit messages in any language via the **custom language** option. Unlike the built-in languages (English, Russian, etc.), a custom language is not bundled — the format template is translated on-demand by the LLM on first use and cached locally in your project.

---

## Setup

1. Open VS Code Settings → **Commit Sage**
2. Set **Commit Language** to `custom`
3. Set **Custom Language Name** to the language you want (e.g. `Ukrainian`, `Italian`, `Arabic`, `Thai`)

Or add to your project's `.commitsage/config.json`:

```json
{
  "commit": {
    "commitLanguage": "custom",
    "customLanguageName": "Ukrainian"
  }
}
```

---

## How It Works

### First commit after selecting a custom language

1. CommitSage checks `.commitsage/translations.json` for a cached template matching the current language + format
2. If not found, sends a translation request to your configured LLM provider
3. Saves the translated template to `.commitsage/translations.json`
4. Uses the translated template to generate the commit message

### Subsequent commits

CommitSage reads the cached template from `.commitsage/translations.json` — no second translation request is made.

---

## Cache File

All translated templates are stored in a single file: `.commitsage/translations.json`.

```json
{
  "Ukrainian": {
    "conventional": "<translated template>",
    "angular": "<translated template>"
  },
  "Italian": {
    "google": "<translated template>"
  }
}
```

Each top-level key is a language name; each nested key is a commit format. When you switch to a new format, the new translation is added under the existing language entry — other languages and formats are not touched.

The translation for a specific language + format is regenerated only if its key is missing (e.g. after deleting the entry or the whole file).

You can commit `.commitsage/translations.json` to share all translated templates with your team.

---

## Project Directory Layout

When the custom language feature writes `translations.json`, CommitSage uses `.commitsage/` as a directory. If your project has a legacy `.commitsage` file (single JSON config), it is automatically migrated at extension startup:

```
.commitsage          →   .commitsage/
                             config.json   (your existing config)
                             translations.json (custom language cache)
```

The migration happens transparently — no manual action required. The existing config contents are preserved.

---

## Notes

- **Custom Language Name is case-sensitive** in the cache key — `Ukrainian` and `ukrainian` are stored as separate entries.
- **Technical terms** (type names like `feat`, `fix`, `docs`, format patterns like `type(scope): description`) are kept in English in the translated template.
- If **Custom Language Name** is left empty while `commitLanguage` is `custom`, CommitSage falls back to the English template.
- The translation quality depends on your LLM provider and model. If the result is poor, delete the relevant entry from `.commitsage/translations.json` to trigger a fresh translation.

---

## Troubleshooting

**Translation request fails** — The same LLM provider and API key configured for commit generation is used. Check that your API key is valid and the provider is reachable. See [troubleshooting.md](troubleshooting.md).

**Commit message is in the wrong language** — Delete the relevant entry from `.commitsage/translations.json` (or delete the whole file) and try again. The file may contain a stale translation.

**`.commitsage` is a file, not a directory** — This migration is handled automatically at extension startup. If you see filesystem errors, check that your project root is writable.
