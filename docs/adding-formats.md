# Adding a New Commit Format to CommitSage

Currently supported: `conventional`, `angular`, `karma`, `semantic`, `emoji`, `emojiKarma`, `google`, `atom`.

Adding a new format requires changes in **5 files**. The examples below use `gitmoji`.

---

## 1. `src/templates/formats/<format>.ts` — format template

Create a new template file with translations for all supported languages:

```typescript
import type { CommitTemplate } from '../index';

export const gitmojiTemplate: CommitTemplate = {
    english: `Generate a commit message following the Gitmoji format:
...your prompt instructions...

Example:
:sparkles: add new feature`,

    russian: `Создайте сообщение коммита в формате Gitmoji:
...`,

    chinese: `...`,
    japanese: `...`,
    korean: `...`,
    german: `...`,
    french: `...`,
    spanish: `...`,
    portuguese: `...`,
};
```

Each template contains detailed instructions for the AI model in the target language. When writing translations, preserve the structure from existing templates (e.g., `conventional.ts`).

The `CommitTemplate` type requires entries for **all 9 languages**: `english`, `russian`, `chinese`, `japanese`, `korean`, `german`, `french`, `spanish`, `portuguese`. The TypeScript compiler will flag any missing translations — `npm run compile` will fail until every language key is present.

A complete template is not just one line — it includes format rules, commit type guidance, examples, and constraints written in the target language. Look at `src/templates/formats/conventional.ts` for a realistic example of the level of detail expected.

## 2. `src/templates/index.ts` — register the template

Import the template and add it to the `templates` record and `CommitFormat` type:

```typescript
import { gitmojiTemplate } from './formats/gitmoji';

export type CommitFormat = 'conventional' | 'angular' | ... | 'gitmoji';

const templates: Record<CommitFormat, CommitTemplate> = {
    // ...existing formats...
    gitmoji: gitmojiTemplate,
};
```

## 3. `src/models/types.ts` — update `ProjectConfig`

Add the format to the `commitFormat` union in the `ProjectConfig` interface:

```typescript
export interface ProjectConfig {
    commit?: {
        commitFormat?: 'conventional' | 'angular' | ... | 'gitmoji';
        // ...
    };
}
```

## 4. `package.json` — VS Code Settings UI enum

Add the value to `contributes.configuration` → `commitSage.commit.commitFormat` → `enum`:

```json
"commitSage.commit.commitFormat": {
    "type": "string",
    "enum": [
        "conventional",
        "angular",
        "karma",
        "semantic",
        "emoji",
        "emojiKarma",
        "google",
        "atom",
        "gitmoji"
    ],
    "default": "conventional"
}
```

## 5. `README.md` — update documentation

Add the new format to the features list and commit format options in README.md so users can discover it.

---

## Verification

After making all changes:

1. `npm run compile` — the TypeScript compiler will verify that the template satisfies `CommitTemplate` (all languages present) and `CommitFormat` is consistent across files.
2. Open VS Code Settings → CommitSage → confirm the new format appears in the dropdown.
3. Select the new format and generate a commit — verify the message follows the expected structure.
