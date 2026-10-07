# ADR-0001: Adaptive payload for OpenAI-compatible requests

**Status:** accepted, 2026-10-07

## Context

OpenAI reasoning models (gpt-5 family, o-series) reject `max_tokens` and any `temperature` except the default 1, with HTTP 400 ([#539](https://github.com/VizzleTF/CommitSage/issues/539)). The same models are reached through OpenAI, Azure, OpenRouter and custom proxies, where the model name is arbitrary. The 400 body names the field in `error.param` or in quotes in `error.message`.

## Decision

We will let the error decide the payload shape. On a 400 that names the token field, `generateViaOpenAICompatible` swaps `max_tokens` and `max_completion_tokens`. On a 400 that names `temperature`, it drops the field. It retries at once, at most twice, and caches the shape per `baseUrl|model` for the session. The OpenAI provider starts with `max_completion_tokens`.

## Consequences

Any OpenAI-compatible provider works with reasoning models without a model list. The first request to such a model per session costs up to two extra 400 round-trips. Only these two fields are repaired. A server whose 400 body does not name the field gets no repair.

## Alternatives considered

- Detect reasoning models by name prefix (`gpt-5`, `o\d`): rejected, because Azure deployments and proxies use arbitrary names.
- Add a user setting for the token field: rejected, because users would have to know the API quirk.
