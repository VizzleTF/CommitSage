## Pick an AI provider

Commit Sage supports 11 providers: Gemini (default), OpenRouter, Groq, Anthropic, OpenAI, DeepSeek, xAI, Codestral, Mistral, Ollama and Custom.

Pick one in either place:

- The **Commit Sage** view in the Activity Bar.
- Settings: set `commitSage.provider.type`.

Some setups need one more setting:

- **Azure OpenAI**: provider `openai`, with `commitSage.openai.baseUrl` set to your Azure endpoint.
- **Other OpenAI-compatible endpoints** (LM Studio, vLLM and similar): provider `custom`, with `commitSage.custom.baseUrl`.
- **Ollama**: no API key by default. If your Ollama instance requires auth, enable `commitSage.ollama.useAuthToken`.

Setup for each provider: [docs/providers.md](https://github.com/VizzleTF/CommitSage/blob/main/docs/providers.md).
