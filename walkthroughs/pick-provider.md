## Pick an AI provider

Commit Sage supports four backends:

- **Gemini** — Google's API. Free tier available; recommended for getting started.
- **OpenAI** — GPT models. Requires an OpenAI key and works with any OpenAI-compatible endpoint (Azure, custom).
- **Codestral** — Mistral's coding model. Requires a Codestral key.
- **Ollama** — Local self-hosted models. No API key by default; enable `ollama.useAuthToken` if your Ollama instance is gated.

Open Settings and set `commitSage.provider.type` to your choice.
