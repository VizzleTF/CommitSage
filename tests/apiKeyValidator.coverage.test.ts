import { describe, it, expect } from 'vitest';
import { ApiKeyValidator } from '../src/utils/apiKeyValidator';

describe('ApiKeyValidator lax validators (validateNonEmpty)', () => {
    const laxValidators: Array<[string, (key: string) => string | null]> = [
        ['Ollama', ApiKeyValidator.validateOllamaAuthToken],
        ['OpenRouter', ApiKeyValidator.validateOpenRouterApiKey],
        ['Groq', ApiKeyValidator.validateGroqApiKey],
        ['Anthropic', ApiKeyValidator.validateAnthropicApiKey],
        ['DeepSeek', ApiKeyValidator.validateDeepSeekApiKey],
        ['Xai', ApiKeyValidator.validateXaiApiKey],
        ['Custom', ApiKeyValidator.validateCustomApiKey],
    ];

    for (const [name, validate] of laxValidators) {
        it(`${name}: rejects empty`, () => {
            expect(validate('')).toBe('API key cannot be empty');
        });
        it(`${name}: accepts any non-empty key`, () => {
            expect(validate('some-$weird/key')).toBeNull();
        });
    }
});
