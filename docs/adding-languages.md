# Add a language

This guide is for contributors who add a bundled language for generated commit messages. The `custom` language value is a different feature: it translates templates at runtime through the LLM and needs no code change (see [custom-language.md](custom-language.md)).

The `SUPPORTED_LANGUAGES` array in `src/utils/constants.ts` defines the bundled languages. The `CommitLanguage` type derives from it. The template type `Record<Exclude<CommitLanguage, 'custom'>, string>` in `src/templates/index.ts` and `LANGUAGE_PROMPTS` in `src/services/promptService.ts` then require a translation for each language, so `npm run typecheck` lists every place that misses one.

The steps use `<LANGUAGE_ID>` for the language id in lowercase English (`italian`).

**Prerequisites:** a working checkout (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Steps

1. Add `'<LANGUAGE_ID>'` to `SUPPORTED_LANGUAGES` in `src/utils/constants.ts`, before `'custom'`:

   ```typescript
   export const SUPPORTED_LANGUAGES = ['english', 'russian', 'chinese', 'japanese', 'korean', 'german', 'french', 'spanish', 'portuguese', '<LANGUAGE_ID>', 'custom'] as const;
   ```

2. Add a `<LANGUAGE_ID>` key with a translated template to each file in `src/templates/formats/`: `angular.ts`, `atom.ts`, `conventional.ts`, `detailed.ts`, `emoji.ts`, `emojiKarma.ts`, `google.ts`, `karma.ts`, `previous.ts` and `semantic.ts`. Keep the sections and examples of the `english` template.

3. Add an entry to `LANGUAGE_PROMPTS` in `src/services/promptService.ts`:

   ```typescript
   const LANGUAGE_PROMPTS: Record<Exclude<CommitLanguage, 'custom'>, string> = {
       // ...existing languages...
       <LANGUAGE_ID>: '<INSTRUCTION_IN_THE_LANGUAGE>',
   };
   ```

4. Add `'<LANGUAGE_ID>'` to the `LANGUAGES` array in `src/views/settingsWebviewProvider.ts`, before `'custom'`. The array fills the language dropdown in the Commit Sage sidebar.

5. In `package.json`, add the id to `contributes.configuration.properties["commitSage.commit.commitLanguage"].enum` before `"custom"`, and the language name to `enumDescriptions` at the same position.

6. Add the language to the user docs: the language line in `README.md`, the `commitLanguage` values in [configuration.md](configuration.md) and the built-in language list in [custom-language.md](custom-language.md).

## Verify

```bash
npm run typecheck
npm run test:unit
```

`npm run typecheck` fails until every template and `LANGUAGE_PROMPTS` have the new key. `npm run compile` only bundles with esbuild and does not type-check.

Then start the extension, select the new language in the Commit Sage sidebar and generate a message. The message is in the new language.
