# Add a commit format

This guide is for contributors who add a new commit message format to Commit Sage. The shipped formats are described in [commit-formats.md](commit-formats.md).

A format is a prompt template with one translation per bundled language, registered under a format id. The steps use `<FORMAT_ID>` for the id (`gitmoji`) and `<FORMAT_NAME>` for the template constant prefix.

**Prerequisites:** a working checkout (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Steps

1. Create `src/templates/formats/<FORMAT_ID>.ts` with a plain object that has one key per language in `SUPPORTED_LANGUAGES` (`src/utils/constants.ts`), except `custom`. Existing templates declare no type: `src/templates/index.ts` checks the object when it registers it.

   ```typescript
   export const <FORMAT_NAME>Template = {
       english: `Generate a commit message following the <FORMAT_NAME> format:
   ...rules, type guidance, examples...`,
       russian: `...`,
       // one key per remaining language
   };
   ```

   Each translation holds the full instructions for the model: format rules, commit type guidance, examples and constraints. Keep the section structure of an existing template such as `src/templates/formats/conventional.ts`.

2. Register the template in `src/templates/index.ts`: import it, add `'<FORMAT_ID>'` to the `CommitFormat` union and add `<FORMAT_ID>: <FORMAT_NAME>Template` to the `templates` record.

3. Add `'<FORMAT_ID>'` to the `FORMATS` array in `src/views/settingsWebviewProvider.ts`, before `'custom'`. The array fills the format dropdown in the Commit Sage sidebar.

4. If the builtin commitlint engine should validate messages in the new format, add an entry to `FORMAT_RULE_SETS` in `src/services/formatRules.ts`. A format without an entry is not validated. If the repository's own commitlint config can check the format (the `project` engine), also add the id to `COMMITLINT_COMPATIBLE_FORMATS`.

5. In `package.json`, add the id to `contributes.configuration.properties["commitSage.commit.commitFormat"].enum` before `"custom"`, and a line to `enumDescriptions` at the same position:

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
           "detailed",
           "previous",
           "<FORMAT_ID>",
           "custom"
       ]
   }
   ```

   If you added the id to `COMMITLINT_COMPATIBLE_FORMATS`, also add it to the format list in `enumDescriptions` of `commitSage.commit.commitlint.engine`.

6. Add the template to the `allTemplates` object in `tests/templates.test.ts`.

7. Update the user docs:
   - [commit-formats.md](commit-formats.md): a section for the format;
   - [configuration.md](configuration.md): the `commitFormat` values, and the `project` engine format list if you changed `COMMITLINT_COMPATIBLE_FORMATS`;
   - `README.md`: the format line.

## Verify

```bash
npm run typecheck
npm run test:unit
```

`npm run typecheck` fails when the template misses a language or `CommitFormat` and `templates` disagree. `npm run compile` only bundles with esbuild and does not type-check.

Then start the extension, select the new format in the Commit Sage sidebar and generate a message. The message follows the structure from the template.
