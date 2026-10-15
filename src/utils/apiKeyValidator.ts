const EMPTY_KEY = 'API key cannot be empty';
const INVALID_CHARS = 'API key contains invalid characters';

/** Validator for providers with a fixed key shape: non-empty, every char in `charset`. */
function charsetValidator(charset: RegExp): (key: string) => string | null {
    return (key: string) => {
        if (!key) {
            return EMPTY_KEY;
        }
        return charset.test(key) ? null : INVALID_CHARS;
    };
}

export class ApiKeyValidator {
    /**
     * Lax non-empty check used for all OpenAI-compatible providers
     * (OpenAI, Groq, OpenRouter, DeepSeek, xAI, Anthropic, Ollama, Custom).
     * No prefix/charset check: providers update key shapes (e.g. `sk-or-v1-`,
     * `gsk_`, `xai-`, `sk-ant-`) and Azure/OpenRouter/LocalAI use yet other
     * formats. Trust the server to reject bad keys. Referenced once per
     * provider from `providerCatalog.ts`.
     */
    static validateNonEmpty(key: string): string | null {
        return key ? null : EMPTY_KEY;
    }

    /**
     * Charset check that allows both old AI Studio keys (`AIza...`) and newer
     * Google keys (`AQ.Ab8...`), the latter containing `.` (see issue #437).
     */
    static readonly validateGeminiApiKey = charsetValidator(/^[A-Za-z0-9._-]+$/);

    static readonly validateCodestralApiKey = charsetValidator(/^[A-Za-z0-9_-]+$/);
}
