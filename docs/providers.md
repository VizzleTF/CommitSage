# AI Providers

CommitSage supports 4 AI providers. This guide covers setup, features, and trade-offs for each.

---

## Provider Comparison

| Provider | Cost | Runs Locally | API Key Required | Custom Endpoint |
|----------|------|-------------|-----------------|-----------------|
| Gemini | Free | No | Yes | No |
| OpenAI | Paid | No | Yes | Yes |
| Codestral | Free | No | Yes | No |
| Ollama | Free | Yes | No | No |

---

## Gemini (Default)

Google's AI models via Google AI Studio.

**Setup:**
1. Get a free API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. In VS Code: Command Palette → "Commit Sage: Set Gemini API Key"

**Models:**
- `auto` (default) — automatically fetches available models and tries each until one succeeds
- `gemini-2.0-flash` — fast, good quality
- `gemini-2.5-pro` — highest quality
- `gemini-2.5-flash` — balanced speed and quality
- And other available Gemini models

**Auto Mode:** When set to `auto`, CommitSage queries the Gemini API for all available models and tries them sequentially. This provides maximum reliability — if one model is temporarily unavailable, the next one is used automatically.

**Settings:**
```json
{
  "commitSage.provider.type": "gemini",
  "commitSage.gemini.model": "auto"
}
```

---

## OpenAI

OpenAI models (GPT-3.5, GPT-4, etc.) or any OpenAI-compatible API.

**Setup:**
1. Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. In VS Code: Command Palette → "Commit Sage: Set OpenAI API Key"

**Custom Endpoints:** Supports any OpenAI-compatible API by changing the base URL. Works with:
- Azure OpenAI
- LocalAI
- LM Studio
- Any other OpenAI-compatible service

**Settings:**
```json
{
  "commitSage.provider.type": "openai",
  "commitSage.openai.model": "gpt-3.5-turbo",
  "commitSage.openai.baseUrl": "https://api.openai.com/v1"
}
```

---

## Codestral

Mistral AI's code-specialized model, available for free.

**Setup:**
1. Get a free API key from [Mistral AI Console](https://console.mistral.ai/codestral)
2. In VS Code: Command Palette → "Commit Sage: Set Codestral API Key"

**Models:**
- `codestral-latest` (default)
- `codestral-2405`

**Settings:**
```json
{
  "commitSage.provider.type": "codestral",
  "commitSage.codestral.model": "codestral-latest"
}
```

---

## Ollama

Run AI models locally on your machine. No API key needed, no data sent to external services.

**Setup:**
1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model: `ollama pull llama3.2`
3. Ollama runs at `http://localhost:11434` by default

**Recommended models:**
- `llama3.2` (default) — good balance of speed and quality
- `codellama` — code-specialized
- `mistral` — fast, good quality

**Auth Token:** If your Ollama instance requires authentication, enable `commitSage.ollama.useAuthToken` and set the token via Command Palette → "Commit Sage: Set Ollama Authentication Token".

**Settings:**
```json
{
  "commitSage.provider.type": "ollama",
  "commitSage.ollama.baseUrl": "http://localhost:11434",
  "commitSage.ollama.model": "llama3.2"
}
```

---

## Choosing a Provider

- **Gemini** — best starting point: free, reliable with auto mode, no local setup
- **Ollama** — best for privacy: everything runs locally, no data leaves your machine
- **OpenAI** — best for quality with GPT-4, or when you need a custom endpoint
- **Codestral** — free alternative optimized for code tasks
