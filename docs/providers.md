# AI Providers

CommitSage supports 10 AI providers — 6 cloud, 1 aggregator, 1 local, plus a generic OpenAI-compatible adapter that closes any self-hosted endpoint. This guide covers setup, features, and trade-offs.

---

## Provider Comparison

| Provider | Cost | Runs Locally | API Key | Region notes (RU) |
|----------|------|-------------|---------|-------------------|
| Gemini | Free tier | No | Yes | VPN required |
| OpenRouter | Free + paid | No | Yes | Works |
| Groq | Free tier | No | Yes | Works |
| Anthropic | Paid | No | Yes | VPN required |
| OpenAI | Paid | No | Yes | Blocked, VPN required |
| DeepSeek | Paid (cheap) | No | Yes | **Works without VPN** |
| xAI | Paid | No | Yes | VPN required |
| Codestral | Free | No | Yes | Works |
| Ollama | Free | **Yes** | No | Works (local) |
| Custom | Depends | Depends | Optional | Depends |

---

## Gemini (Default)

Google's AI models via Google AI Studio.

**Setup:**
1. Get a free API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sidebar → pick Gemini → `Set` → paste key — or Command Palette → `Commit Sage: Set Gemini API Key`

**Models:** `auto` (default) — fetches available models and tries each until one succeeds. Robust to model deprecations.

**Settings:**
```json
{
  "commitSage.provider.type": "gemini",
  "commitSage.gemini.model": "auto"
}
```

---

## OpenRouter

One API key, 300+ models from OpenAI, Anthropic, Google, xAI, DeepSeek, Meta, Mistral, Qwen, and more.

**Setup:**
1. Sign up at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Sidebar → OpenRouter → `Set`

**Free tier:** 25+ models with `:free` suffix (Llama 3.3 70B, DeepSeek V3, GPT-OSS 120B, Qwen3 Coder, etc.). 20 RPM / 50 RPD at $0 balance; 1000 RPD after a $10 top-up.

**Free models filter:** `commitSage.openrouter.preferFreeModels` (default `true`) restricts the model dropdown to free models only. Toggle off to browse all 300+.

**Settings:**
```json
{
  "commitSage.provider.type": "openrouter",
  "commitSage.openrouter.model": "meta-llama/llama-3.3-70b-instruct:free",
  "commitSage.openrouter.preferFreeModels": true
}
```

---

## Groq

Fastest commercial inference on the market (~200–500 ms for Llama 3.3 70B).

**Setup:**
1. Get a key from [console.groq.com/keys](https://console.groq.com/keys) (email + phone, no card)
2. Sidebar → Groq → `Set`

**Free tier:** 30 RPM / 1000 RPD on 70B; up to 14 400 RPD on `llama-3.1-8b-instant` (effectively unlimited for commit messages).

**Recommended models:** `llama-3.1-8b-instant` (max throughput), `llama-3.3-70b-versatile` (quality, default), `mixtral-8x7b-32768`.

**Settings:**
```json
{
  "commitSage.provider.type": "groq",
  "commitSage.groq.model": "llama-3.3-70b-versatile"
}
```

---

## Anthropic Claude

Claude models directly from Anthropic.

**Setup:**
1. Get an API key from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Sidebar → Anthropic Claude → `Set`

**Models (curated static list — Anthropic has no public `/models` endpoint):**
- `claude-opus-4-1-20250805` — highest quality
- `claude-sonnet-4-5-20250929` — default, balanced
- `claude-haiku-4-5-20251001` — fastest, cheapest
- `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022` — previous generation

Keep the list in sync with [docs.anthropic.com/en/docs/about-claude/models](https://docs.anthropic.com/en/docs/about-claude/models).

**Note:** Pro/Max subscription OAuth tokens are not usable here — Anthropic's Usage Policy restricts those to native Anthropic clients. Use an API key from the console.

**Settings:**
```json
{
  "commitSage.provider.type": "anthropic",
  "commitSage.anthropic.model": "claude-sonnet-4-5-20250929"
}
```

---

## OpenAI

OpenAI models (GPT-4o, GPT-4.1, o-series).

**Setup:**
1. Get an API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sidebar → OpenAI → `Set`

**Custom endpoint:** `commitSage.openai.baseUrl` accepts any OpenAI-compatible URL (Azure OpenAI, LocalAI). For self-hosted setups prefer the dedicated **Custom** provider instead — it doesn't conflate official OpenAI defaults with self-hosted overrides.

**Settings:**
```json
{
  "commitSage.provider.type": "openai",
  "commitSage.openai.model": "gpt-4o-mini",
  "commitSage.openai.baseUrl": "https://api.openai.com/v1"
}
```

---

## DeepSeek

DeepSeek's flagship models. **Works without VPN in restricted regions.**

**Setup:**
1. Get a key from [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
2. Sidebar → DeepSeek → `Set`

**Models:** `deepseek-chat` (default), `deepseek-reasoner`.

**Settings:**
```json
{
  "commitSage.provider.type": "deepseek",
  "commitSage.deepseek.model": "deepseek-chat"
}
```

---

## xAI Grok

xAI's Grok models.

**Setup:**
1. Get a key from [console.x.ai](https://console.x.ai/)
2. Sidebar → xAI Grok → `Set`

**Models:** `grok-2-1212` (default, stable), `grok-3-mini`, others as released.

**Settings:**
```json
{
  "commitSage.provider.type": "xai",
  "commitSage.xai.model": "grok-2-1212"
}
```

---

## Codestral

Mistral AI's code-specialized model on the dedicated Codestral subdomain. Free tier.

**Setup:**
1. Get a free API key from [console.mistral.ai/codestral](https://console.mistral.ai/codestral)
2. Sidebar → Codestral → `Set`

**Models:** `codestral-latest` (default), `codestral-2508`, `codestral-2501`, `codestral-2405`.

**Settings:**
```json
{
  "commitSage.provider.type": "codestral",
  "commitSage.codestral.model": "codestral-latest"
}
```

---

## Ollama

Run models locally. No API key, no data leaves your machine.

**Setup:**
1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model: `ollama pull llama3.2` (or `qwen2.5-coder:7b` for code-specialized)
3. Sidebar → Ollama (default base URL `http://localhost:11434`)

**Recommended models:** `qwen2.5-coder:7b` (code), `llama3.2:3b` (fits 4 GB RAM), `deepseek-coder-v2:16b` (powerful hardware).

**Auth token:** For hosted Ollama instances behind auth, enable `commitSage.ollama.useAuthToken` and set the token via `Commit Sage: Set Ollama Auth Token`.

**Settings:**
```json
{
  "commitSage.provider.type": "ollama",
  "commitSage.ollama.baseUrl": "http://localhost:11434",
  "commitSage.ollama.model": "llama3.2"
}
```

---

## Custom OpenAI-compatible

Any OpenAI-compatible `chat/completions` endpoint — local or remote, with or without auth.

**Common targets:**
- **LM Studio** — `http://localhost:1234/v1`
- **Ollama (OpenAI-compat mode)** — `http://localhost:11434/v1` (alternative to the native Ollama provider above)
- **vLLM** — `http://localhost:8000/v1` (any self-hosted Mistral/Llama/Qwen/etc. served via vLLM)
- **TGI (HuggingFace Text Generation Inference)** — `http://your-tgi-host/v1`
- **llama.cpp server** — `http://localhost:8080/v1`
- **LocalAI** — `http://localhost:8080/v1`
- **NVIDIA NIM (free hosted models)** — `https://integrate.api.nvidia.com/v1` + key from <https://build.nvidia.com/settings/api-keys>; covers free coding models like `meta/llama-3.3-70b-instruct`, `qwen/qwen2.5-coder-32b-instruct`
- **Together AI** — `https://api.together.xyz/v1` (needs key)
- **Fireworks** — `https://api.fireworks.ai/inference/v1` (needs key)
- **Cerebras**, **DeepInfra**, **private deployments** — any URL exposing OpenAI wire format

**Setup:**
1. Sidebar → Custom (OpenAI-compatible)
2. Set **Base URL** to your endpoint
3. Set **Model** to whatever model ID your endpoint exposes (free-form text — no listing available)
4. If your endpoint requires auth: enable `Send API key`, then `Set` to paste the key

**Settings:**
```json
{
  "commitSage.provider.type": "custom",
  "commitSage.custom.baseUrl": "http://localhost:1234/v1",
  "commitSage.custom.model": "qwen2.5-coder",
  "commitSage.custom.useApiKey": false,
  "commitSage.custom.chatCompletionsPath": "/chat/completions"
}
```

---

## Choosing a Provider

- **Gemini** — best free starting point, auto-mode handles model rotation
- **OpenRouter** — one key, access to almost everything (incl. 25+ free models)
- **Groq** — fastest replies + the most generous free tier
- **Anthropic** — best output quality at higher cost
- **DeepSeek** — works from regions where US providers are blocked
- **Ollama** — best for privacy / offline / sensitive repos
- **Custom** — any self-hosted server (LM Studio, vLLM, llama.cpp) without per-vendor wiring
- **OpenAI** — when you specifically want GPT models
- **xAI** — when you specifically want Grok
- **Codestral** — free code-specialized fallback
