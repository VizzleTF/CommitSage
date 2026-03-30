# Adding a New Language to CommitSage

Currently supported: `english`, `russian`, `chinese`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`.

The single source of truth is the `SUPPORTED_LANGUAGES` array in `src/utils/constants.ts`. The `CommitLanguage` type and `CommitTemplate` interface are derived from it automatically, so the TypeScript compiler enforces translation completeness across all templates.

Adding a new language requires changes in **5 files**. The examples below use `italian`.

---

## 1. `src/utils/constants.ts` — language list

Add the value to the `SUPPORTED_LANGUAGES` array:

```typescript
export const SUPPORTED_LANGUAGES = ['english', 'russian', 'chinese', 'japanese', 'korean', 'german', 'french', 'spanish', 'portuguese', 'italian'] as const;
```

The `CommitLanguage` type updates automatically. The compiler will immediately flag all places missing the new language (format templates and `LANGUAGE_PROMPTS`).

## 2. `src/templates/formats/*.ts` — format templates (8 files)

Add a translated template with the new language key in each file:

- `angular.ts`
- `atom.ts`
- `conventional.ts`
- `emoji.ts`
- `emojiKarma.ts`
- `google.ts`
- `karma.ts`
- `semantic.ts`

Example for `conventional.ts`:

```typescript
export const conventionalTemplate = {
    english: `...`,
    russian: `...`,
    // ...existing languages...
    italian: `Genera un messaggio di commit nel formato Conventional Commits:
<tipo>[ambito opzionale]: <descrizione>

[corpo opzionale con elenco puntato]

Regole:
1. Prima riga: tipo(ambito): descrizione (max 50 caratteri)
...`,
};
```

Each template contains detailed instructions for the AI model in the target language: format rules, commit type selection, and examples. When translating, preserve the structure and number of sections from the existing templates (e.g. `english`).

## 3. `src/services/promptService.ts` — language prompt

Add an entry to `LANGUAGE_PROMPTS`:

```typescript
const LANGUAGE_PROMPTS: Record<CommitLanguage, string> = {
    // ...existing languages...
    italian: 'Per favore, scrivi il messaggio del commit in italiano.',
};
```

## 4. `package.json` — VS Code Settings UI enum

Add the value to `contributes.configuration` → `commitSage.commit.commitLanguage` → `enum`:

```json
"commitSage.commit.commitLanguage": {
    "type": "string",
    "enum": [
        "english",
        "russian",
        "chinese",
        "japanese",
        "korean",
        "german",
        "french",
        "spanish",
        "portuguese",
        "italian"
    ],
    "default": "english"
}
```

## 5. `README.md` — update documentation

Add the new language to the features list and the language options in README.md so users can discover it. Update both the English and Russian sections of the README.

---

## Verification

After making all changes:

1. `npm run compile` — the TypeScript compiler will verify that the new language field is present in all templates and in `LANGUAGE_PROMPTS`.
2. Open VS Code Settings → CommitSage → confirm the new language appears in the dropdown.
3. Select the new language and generate a commit — verify the message is generated in the correct language.
