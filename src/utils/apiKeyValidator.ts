
const apiValidation = {
    keyFormat: /^[A-Za-z0-9_-]+$/,
    openaiTestEndpoint: 'https://api.openai.com/v1/models',
    errorMessages: {
        emptyKey: 'API key cannot be empty',
        invalidChars: 'API key contains invalid characters'
    }
} as const;

export class ApiKeyValidator {
    /**
     * Lax non-empty check used for all OpenAI-compatible providers
     * (OpenAI, Groq, OpenRouter, DeepSeek, xAI, Anthropic, Codestral).
     * No prefix/charset check: providers update key shapes (e.g. `sk-or-v1-`,
     * `gsk_`, `xai-`, `sk-ant-`) and Azure/OpenRouter/LocalAI use yet other
     * formats. Trust the server to reject bad keys.
     */
    private static validateNonEmpty(key: string): string | null {
        if (!key) {
            return apiValidation.errorMessages.emptyKey;
        }
        return null;
    }

    static validateOpenAIApiKey(key: string): string | null {
        return ApiKeyValidator.validateNonEmpty(key);
    }

    /** Strict charset validation shared by providers with a fixed key shape. */
    private static validateStrictFormat(key: string): string | null {
        if (!key) {
            return apiValidation.errorMessages.emptyKey;
        }
        if (!apiValidation.keyFormat.test(key)) {
            return apiValidation.errorMessages.invalidChars;
        }
        return null;
    }

    static validateGeminiApiKey(key: string): string | null {
        return ApiKeyValidator.validateStrictFormat(key);
    }

    static validateCodestralApiKey(key: string): string | null {
        return ApiKeyValidator.validateStrictFormat(key);
    }

    static validateOllamaAuthToken(key: string): string | null {
        return ApiKeyValidator.validateNonEmpty(key);
    }

    static validateOpenRouterApiKey(key: string): string | null {
        return ApiKeyValidator.validateNonEmpty(key);
    }

    static validateGroqApiKey(key: string): string | null {
        return ApiKeyValidator.validateNonEmpty(key);
    }

    static validateAnthropicApiKey(key: string): string | null {
        return ApiKeyValidator.validateNonEmpty(key);
    }

    static validateDeepSeekApiKey(key: string): string | null {
        return ApiKeyValidator.validateNonEmpty(key);
    }

    static validateXaiApiKey(key: string): string | null {
        return ApiKeyValidator.validateNonEmpty(key);
    }

    static validateCustomApiKey(key: string): string | null {
        return ApiKeyValidator.validateNonEmpty(key);
    }
}
