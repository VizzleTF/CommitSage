# AI Providers

Commit Sage supports 11 providers: 8 cloud APIs (Gemini, Codestral, Mistral, OpenAI, Groq, Anthropic, DeepSeek, xAI), the OpenRouter aggregator, local Ollama, and a Custom adapter for any OpenAI-compatible endpoint. This page shows how to set up each one. Every setting with its type and default is in [configuration.md](configuration.md).

Setting keys on this page omit the `commitSage.` prefix: `provider.type` means `commitSage.provider.type`.

## Provider comparison

| Provider | `provider.type` | Runs | API key | Model list in the sidebar |
|----------|-----------------|------|---------|---------------------------|
| Gemini (default) | `gemini` | Cloud | Required | Fetched from the Google Generative Language API |
| OpenRouter | `openrouter` | Cloud | Required | Fetched from `openrouter.ai/api/v1/models` |
| Groq | `groq` | Cloud | Required | Fetched from `api.groq.com/openai/v1/models` |
| Anthropic Claude | `anthropic` | Cloud | Required | Fetched from `api.anthropic.com/v1/models` |
| OpenAI | `openai` | Cloud | Required | Fetched from `<openai.baseUrl>/models` |
| DeepSeek | `deepseek` | Cloud | Required | Fetched from `api.deepseek.com/models` |
| xAI Grok | `xai` | Cloud | Required | Fetched from `api.x.ai/v1/models`; built-in list if the request fails |
| Codestral | `codestral` | Cloud | Required | Built-in list |
| Mistral | `mistral` | Cloud | Required | Fetched from `api.mistral.ai/v1/models` |
| Ollama | `ollama` | Local or self-hosted | Optional auth token | Fetched from `<ollama.baseUrl>/api/tags` |
| Custom (OpenAI-compatible) | `custom` | Any | Optional | None; type the model ID |

## Data use

Commit Sage sends your diff and prompt to the provider you pick. What happens to them next is set by the provider's terms, not by Commit Sage. The table summarizes those terms for API use as checked in October 2026. Terms change, so read the linked page before you send private code. "Not stated" means the linked page does not say.

| Provider | Trains on your data | Retention | Human review | Notes | Terms |
|----------|---------------------|-----------|--------------|-------|-------|
| Gemini (default) | Free tier: yes, to "provide, improve, and develop" Google products. Paid tier: no. | Paid tier: logged for a limited period to detect abuse and meet legal requirements. Free tier: not stated. | Free tier: yes, reviewers may read and annotate inputs and outputs. Paid tier: not stated. | Google asks not to send sensitive, confidential or personal data to the free tier. In the EEA, Switzerland and the UK the paid-tier data terms apply to free use too. | [Gemini API terms](https://ai.google.dev/gemini-api/terms) |
| OpenAI | No, unless you opt in. | Abuse-monitoring logs for up to 30 days. Zero Data Retention needs OpenAI's approval. | Not stated | Data residency is set per project: US, Europe and other regions. | [Your data](https://developers.openai.com/api/docs/guides/your-data) |
| Anthropic | No by default. Feedback you send, such as a thumbs rating, and an explicit opt-in can be used. | Deleted within 30 days. Inputs flagged for a usage policy violation are kept for up to 2 years. | Not stated | | [Training](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-training), [retention](https://privacy.claude.com/en/articles/7996866-how-long-does-anthropic-store-my-organizations-data) |
| Groq | Not stated; the Groq Services Agreement governs it. | Not retained by default. Reliability and abuse logs for up to 30 days. Zero Data Retention is a toggle in Data Controls. | Not stated | | [Your data](https://console.groq.com/docs/your-data) |
| xAI | No, without your explicit permission. | 30 days for auditing. Zero Data Retention is available. | Not stated | | [Security FAQ](https://docs.x.ai/developers/faq/security) |
| Mistral, Codestral | Free mode: yes, unless you opt out. Pay-as-you-go: you can opt out. | Not stated | Not stated | Opt out in the Mistral Admin panel under Privacy > Anonymous improvement data. The pages do not name Codestral separately. | [Training](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models), [opt out](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training) |
| DeepSeek | Yes, to train and improve its models. You can opt out by email to privacy@deepseek.com. | As long as you have an account. | Not stated | Data is processed and stored in the People's Republic of China. | [Privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) |
| OpenRouter | Depends on the provider the request is routed to. By default, routing includes providers that store data and may train on it. | Depends on the provider. | Depends on the provider. | Commit Sage sends no routing preference. To skip providers that train on data, change your [OpenRouter privacy settings](https://openrouter.ai/settings/privacy); free models have a separate setting. The default model `openrouter/free` routes to free models. | [Provider selection](https://openrouter.ai/docs/guides/routing/provider-selection), [provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging) |
| Ollama, Custom on your own server | No | Your machine or server only. | No | No third party receives the data. | |
| Custom on a hosted service | Set by that service. | Set by that service. | Set by that service. | For example Together AI, Fireworks or NVIDIA NIM. | That service's terms |

Whatever the provider, Commit Sage sends only the path of `.env`, key and certificate files and masks known secret formats in the rest of the diff. See [Sensitive files and secrets](configuration.md#sensitive-files-and-secrets).

## Set up a provider

1. Open the Commit Sage sidebar and pick the provider.
2. Press `Get key ↗` to open the provider's key page, and create a key.
3. Press `Set` and paste the key, or run the command listed in the provider's section.
4. If the provider fetches its model list, press `Refresh` and pick a model.

Ollama and Custom skip steps 2–3 unless the server needs a key. The sidebar shows `● set` next to a stored key. Keys are kept in VS Code SecretStorage. Commands that remove a key or pick a Gemini model are listed in [configuration.md](configuration.md#commands).

## Gemini

Google Gemini models through the Gemini API. This is the default provider.

- Key: [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- Command: `Commit Sage: Set Gemini API Key`
- Settings:
  - `gemini.model`: default `auto`.
  - `gemini.thinkingBudget`: default `0`. Thinking token budget for Gemini 2.5 models; `0` disables thinking, `-1` lets the model decide.
  - `gemini.thinkingLevel`: default `low`. Thinking depth for Gemini 3.x models: `minimal`, `low`, `medium` or `high`.

With `auto`, the extension fetches the models that support `generateContent` and keeps names that start with `gemini-`, which drops Gemma and LearnLM. It also drops image, audio, TTS, embedding and other non-text variants. It sorts the rest `pro` first, then `flash`, then `flash-lite`, newer versions first within each group, and tries each model in that order until one returns a message. If the model list cannot be fetched, it uses a built-in list of four models. If Google rejects the key, Commit Sage asks for a new one instead.

Gemini 3.x models cannot turn thinking off and ignore `gemini.thinkingBudget`. Gemini 2.5 Pro cannot disable thinking either: a budget of `0` is raised to `128` for that model.

## OpenRouter

One key for models from many vendors, routed through `openrouter.ai`.

- Key: [openrouter.ai/keys](https://openrouter.ai/keys), or press `Sign in with OpenRouter` in the sidebar. The sign-in uses OAuth with PKCE and stores the created key.
- Commands: `Commit Sage: Set OpenRouter API Key`, `Commit Sage: Sign in to OpenRouter`
- Settings:
  - `openrouter.model`: default `openrouter/free`, OpenRouter's router that sends each request to one of the free models available at that moment.
  - `openrouter.preferFreeModels`: default `false`. When `true`, the model list shows only free models: IDs ending in `:free` or with zero prompt and completion pricing. In the sidebar this is `Show free models only`.

## Groq

Open-weight models served by Groq.

- Key: [console.groq.com/keys](https://console.groq.com/keys)
- Command: `Commit Sage: Set Groq API Key`
- Settings: `groq.model`, default `openai/gpt-oss-20b`.

## Anthropic Claude

Claude models from the Anthropic API.

- Key: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- Command: `Commit Sage: Set Anthropic API Key`
- Settings: `anthropic.model`, default `claude-haiku-5-5`.

The model list in the sidebar comes from the Anthropic `/v1/models` endpoint, so it shows the models your key can use.

Pro and Max subscription OAuth tokens are not supported; use an API key from the Anthropic Console.

## OpenAI

OpenAI models from the OpenAI API.

- Key: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Command: `Commit Sage: Set OpenAI API Key`
- Settings:
  - `openai.model`: default `gpt-6-luna`.
  - `openai.baseUrl`: default `https://api.openai.com/v1`. Change it for Azure OpenAI or another OpenAI-compatible endpoint.

The model list keeps only IDs that start with `gpt-`, `chatgpt-`, `o1`, `o3` or `o4`. For a self-hosted server, use the Custom provider: it has its own base URL, path and optional key, and leaves the OpenAI settings unchanged.

## DeepSeek

DeepSeek models from the DeepSeek API.

- Key: [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
- Command: `Commit Sage: Set DeepSeek API Key`
- Settings: `deepseek.model`, default `deepseek-flash`.

## xAI Grok

Grok models from the xAI API.

- Key: [console.x.ai](https://console.x.ai/)
- Command: `Commit Sage: Set xAI API Key`
- Settings: `xai.model`, default `grok-4.3`.

If the request to `/v1/models` fails or returns no models, the sidebar shows a built-in list: `grok-4.7`, `grok-4.6`, `grok-4.5`, `grok-4.3`, `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`, `grok-build-0.1`. One cause is an account without credits or a license, where xAI rejects the request. Generating a message still needs credits.

## Codestral

Mistral's code models on the dedicated endpoint `codestral.mistral.ai`.

- Key: [console.mistral.ai/codestral](https://console.mistral.ai/codestral)
- Command: `Commit Sage: Set Codestral API Key`
- Settings: `codestral.model`, default `codestral-latest`. The built-in list also has `codestral-2508`, `codestral-2501` and `codestral-2405`.

The Codestral key and the Mistral (La Plateforme) key are issued in different sections of the console. One does not work in place of the other.

## Mistral

Mistral models on La Plateforme (`api.mistral.ai`), including models outside the Codestral family.

- Key: [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys)
- Command: `Commit Sage: Set Mistral API Key`
- Settings: `mistral.model`, default `mistral-small-latest`.

The model list keeps chat-capable, non-archived models. Embedding, OCR, moderation and FIM models are dropped because they do not answer `/chat/completions`.

## Ollama

Models run by an Ollama server, on your machine or on another host.

- Key: none for a local server. Install Ollama from [ollama.com](https://ollama.com), pull a model with `ollama pull llama3.2`, then press `Refresh` in the sidebar.
- Command: `Commit Sage: Set Ollama Auth Token`, for a server that needs a token.
- Settings:
  - `ollama.baseUrl`: default `http://localhost:11434`.
  - `ollama.model`: default `llama3.2`.
  - `ollama.numCtx`: default `0`. Context window sent to Ollama as `options.num_ctx`; `0` keeps the model's own default.
  - `ollama.useAuthToken`: default `false`. When `true`, the extension sends the stored token as a Bearer token.

## Custom (OpenAI-compatible)

Any server that speaks the OpenAI `chat/completions` format.

- Key: only if the server needs one; see the table below.
- Command: `Commit Sage: Set Custom API Key`
- Settings:
  - `custom.baseUrl`: default `http://localhost:1234/v1`.
  - `custom.model`: default empty. Required: the extension sends this ID as is.
  - `custom.useApiKey`: default `false`. When `true`, the extension sends the stored key. In the sidebar this is `Send API key`.
  - `custom.chatCompletionsPath`: default `/chat/completions`. Appended to the base URL.

| Server | Base URL | Key |
|--------|----------|-----|
| LM Studio | `http://localhost:1234/v1` | Not needed by default |
| vLLM | `http://localhost:8000/v1` | Depends on server config |
| llama.cpp server | `http://localhost:8080/v1` | Not needed by default |
| LocalAI | `http://localhost:8080/v1` | Depends on server config |
| Ollama (OpenAI mode) | `http://localhost:11434/v1` | Not needed for a local server |
| TGI | `http://<TGI_HOST>/v1` | Depends on server config |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | Required: [build.nvidia.com/settings/api-keys](https://build.nvidia.com/settings/api-keys) |
| Together AI | `https://api.together.xyz/v1` | Required |
| Fireworks | `https://api.fireworks.ai/inference/v1` | Required |

Example for a server that needs a key:

```json
{
  "commitSage.provider.type": "custom",
  "commitSage.custom.baseUrl": "https://api.together.xyz/v1",
  "commitSage.custom.model": "<MODEL_ID>",
  "commitSage.custom.useApiKey": true
}
```

Then run `Commit Sage: Set Custom API Key` and paste the key.
