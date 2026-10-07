## Provide credentials

API keys are stored in VS Code SecretStorage, not in settings files.

Run the command for your provider from the Command Palette. Each has the form `Commit Sage: Set <PROVIDER> API Key`:

- `Commit Sage: Set Gemini API Key`
- `Commit Sage: Set OpenRouter API Key`
  or `Commit Sage: Sign in to OpenRouter` instead of pasting a key
- `Commit Sage: Set Groq API Key`
- `Commit Sage: Set Anthropic API Key`
- `Commit Sage: Set OpenAI API Key`
- `Commit Sage: Set DeepSeek API Key`
- `Commit Sage: Set xAI API Key`
- `Commit Sage: Set Codestral API Key`
- `Commit Sage: Set Mistral API Key`
- `Commit Sage: Set Ollama Auth Token`
- `Commit Sage: Set Custom API Key`

The **Commit Sage** view in the Activity Bar has the same button for the selected provider.

Skip this step for local Ollama without auth and for Custom endpoints that need no key. Custom sends a key only when `commitSage.custom.useApiKey` is enabled; it is off by default.
