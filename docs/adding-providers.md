# Add an AI provider

This guide is for contributors who add a new LLM provider to Commit Sage. The list of shipped providers is in [providers.md](providers.md).

Every provider has a catalog entry and a generation path. The path depends on the wire format:

- **OpenAI-compatible** (`POST <BASE_URL>/chat/completions`, OpenAI request and response shape): one row in `COMPAT_SPECS`. The shared dispatcher in `src/services/openAICompatibleService.ts` does the request, retries and response checks.
- **Any other format**: a service class registered in `NON_COMPAT_SERVICES` in `src/services/aiServiceFactory.ts`. `src/services/anthropicService.ts` is the smallest example.

The steps use `<PROVIDER_ID>` for the lowercase provider id (`deepseek`), `<NAME>` for the PascalCase name in command ids (`DeepSeek`) and `<DEFAULT_MODEL>` for the default model id.

**Prerequisites:** a working checkout (see [CONTRIBUTING.md](../CONTRIBUTING.md)) and the provider's API documentation.

## Steps

1. Add `'<PROVIDER_ID>'` to the `Provider` union in `src/views/webview/protocol.ts`.

2. Add an entry to `PROVIDER_CATALOG` in `src/services/providerCatalog.ts`. The array order is the display order in the model picker.

   ```typescript
   {
       id: '<PROVIDER_ID>',
       label: '<LABEL>',               // model picker
       displayName: '<DISPLAY_NAME>',  // "Enter your <DISPLAY_NAME> API Key"
       secretKey: 'commitsage.<PROVIDER_ID>ApiKey',
       setCmd: 'commitsage.set<NAME>ApiKey',
       removeCmd: 'commitsage.remove<NAME>ApiKey',
       apiKeyUrl: '<API_KEY_URL>',
       liveSource: '<MODEL_LIST_SOURCE>',
       validateKey: lax,
   },
   ```

   The catalog drives the rest of the wiring. `registerSetApiKeyCommands` in `src/commands/setApiKeys.ts` registers `setCmd` and `removeCmd` for every entry. `isProvider()` accepts the new id, so `ConfigService.getProvider()` and `ApiKeyManager` accept it too. Set `noRefresh: true` when the provider has no model listing endpoint: the settings view then hides the refresh button.

3. Add the generation path.

   - If the provider is OpenAI-compatible, add a row to `COMPAT_SPECS` in `src/services/openAICompatibleService.ts`:

     ```typescript
     <PROVIDER_ID>: { baseUrl: () => '<BASE_URL>' },
     ```

     The other fields of `CompatProviderSpec` are optional: `extraHeaders`, `chatCompletionsPath`, `getApiKey` and `maxTokensParam`. The API key and the label come from the catalog, the model default from `SETTING_DEFAULTS` (step 5).

   - Otherwise, create `src/services/<PROVIDER_ID>Service.ts` with a class that has a static `generateCommitMessage(prompt, progress, attempt, options)` returning `Promise<CommitMessage>`. Use the helpers from `src/services/baseAIService.ts`, as `anthropicService.ts` does:
     - wrap the request in `withRetryAndApiKeyGuard()`: it maps HTTP errors through `handleHttpError()`, retries and turns an invalid key into `ApiKeyInvalidError`;
     - pass the response text to `extractAndValidateMessage()`;
     - take the request limits from `getConfiguredTemperature()` and `resolveMaxOutputTokens()`, and pass `options?.signal` to the HTTP call.

     Then register the class in `NON_COMPAT_SERVICES` in `src/services/aiServiceFactory.ts`.

4. Add an entry to `PROVIDER_BEHAVIOR` in `src/services/providerRegistry.ts` with `selectedModel` and `fetchModels`. Put a fetch function for the model list in `src/services/modelLists.ts`. A provider without a listing endpoint returns `[]` (as `custom` does) or a static list (as `fetchAnthropicModels` does).

5. Add the model setting default to `SETTING_DEFAULTS` in `src/utils/configService.ts`. `ConfigService.getModelFor()` reads `<PROVIDER_ID>.model` for every provider.

   ```typescript
   '<PROVIDER_ID>.model': '<DEFAULT_MODEL>',
   ```

6. Add `<PROVIDER_ID>Model: '<PROVIDER_ID>.model',` to `SETTING_PATHS` in `src/views/settingsWebviewProvider.ts`. The model picker in the settings view looks up the key `` `${provider}Model` ``.

7. Add the provider section to `ProjectConfig` in `src/models/types.ts`. `provider.type` is a `string`, so it needs no change.

   ```typescript
   <PROVIDER_ID>?: {
       model?: string;
   };
   ```

8. Update `package.json` under `contributes`:
   - `configuration.properties["commitSage.provider.type"]`: add the id to `enum` and a line to `enumDescriptions` at the same position;
   - add a `commitSage.<PROVIDER_ID>.model` property with `"default": "<DEFAULT_MODEL>"`;
   - add the `setCmd` and `removeCmd` commands to `commands`, with titles `%command.set<NAME>ApiKey.title%` and `%command.remove<NAME>ApiKey.title%` and `"category": "%command.category%"`;
   - add `onCommand:commitsage.set<NAME>ApiKey` to `completionEvents` of the `setApiKey` walkthrough step.

9. Add the two command titles to `package.nls.json`, and the provider name to `walkthrough.step.pickProvider.description`. In `walkthroughs/pick-provider.md`, update the provider count and list; in `walkthroughs/set-api-key.md`, add the `Commit Sage: Set <NAME> API Key` command.

10. Update the tests:
    - `tests/providerRegistry.test.ts` asserts the full `PROVIDERS` list and the `NO_REFRESH_PROVIDERS` list; add the new id;
    - add a payload test to `tests/providerPayloads.test.ts` that checks the request URL and body;
    - `tests/providerDispatchCompleteness.test.ts` needs no edit: it fails when a catalog provider has no generation path;
    - hard-coded provider lists that do not fail but leave the new provider untested: `COMPAT` and `compatCases` in `tests/aiServiceFactory.test.ts` (OpenAI-compatible providers only) and the `ConfigService.getModel` cases in `tests/configService.coverage.test.ts`. A test in `tests/providerServices.coverage.test.ts` also needs `'<PROVIDER_ID>.model'` in its mocked `SETTINGS`.

11. Update the user docs:
    - [providers.md](providers.md): the provider count, the table row and a section for the provider;
    - [configuration.md](configuration.md): the `provider.type` values, the `<PROVIDER_ID>.model` setting and the two commands;
    - `README.md`: the provider count and list.

## Verify

```bash
npm run typecheck
npm run test:unit
npm run lint
```

`npm run compile` only bundles with esbuild and does not type-check. `npm run typecheck` reports a missing `PROVIDER_BEHAVIOR` entry or a wrong `SETTING_PATHS` value.

Then start the extension in VS Code and check:

1. The provider appears in the `commitSage.provider.type` dropdown and in the Commit Sage sidebar.
2. `Commit Sage: Set <NAME> API Key` stores a key from the Command Palette.
3. Commit Sage generates a message with the new provider.
4. An invalid key produces a prompt to enter a new key.
