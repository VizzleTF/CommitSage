import { describe, it, expect, vi, beforeEach } from 'vitest';

const make = (name: string) => ({
    generateCommitMessage: vi.fn(async () => ({ message: `from-${name}`, model: name })),
});

const { GeminiService, OllamaService, AnthropicService } = vi.hoisted(() => ({
    GeminiService: { generateCommitMessage: undefined as never },
    OllamaService: { generateCommitMessage: undefined as never },
    AnthropicService: { generateCommitMessage: undefined as never },
}));

// OpenAI-compatible providers route through one shared dispatcher; mock it to
// echo the provider id so we can assert which provider was dispatched.
const { generateViaOpenAICompatibleProvider, COMPAT } = vi.hoisted(() => ({
    generateViaOpenAICompatibleProvider: vi.fn(
        async (provider: string) => ({ message: `from-${provider}`, model: provider }),
    ),
    COMPAT: new Set(['openai', 'codestral', 'openrouter', 'groq', 'deepseek', 'xai', 'custom']),
}));

vi.mock('../src/services/geminiService', () => ({ GeminiService }));
vi.mock('../src/services/ollamaService', () => ({ OllamaService }));
vi.mock('../src/services/anthropicService', () => ({ AnthropicService }));
vi.mock('../src/services/openAICompatibleService', () => ({
    generateViaOpenAICompatibleProvider,
    isOpenAICompatibleProvider: (p: string) => COMPAT.has(p),
}));

import { AIServiceFactory } from '../src/services/aiServiceFactory';
import type { Provider } from '../src/views/webview/protocol';

const progress = { report: () => undefined };

beforeEach(() => {
    Object.assign(GeminiService, make('gemini'));
    Object.assign(OllamaService, make('ollama'));
    Object.assign(AnthropicService, make('anthropic'));
    generateViaOpenAICompatibleProvider.mockClear();
});

describe('AIServiceFactory.generateCommitMessage routing', () => {
    const classCases: Array<[Provider, { generateCommitMessage: ReturnType<typeof vi.fn> }, string]> = [
        ['gemini', GeminiService as never, 'gemini'],
        ['ollama', OllamaService as never, 'ollama'],
        ['anthropic', AnthropicService as never, 'anthropic'],
    ];

    it.each(classCases)('routes %s to its dedicated service class', async (type, svc, name) => {
        const opts = { maxTokens: 10 };
        const result = await AIServiceFactory.generateCommitMessage(type, 'prompt', progress, 2, opts);
        expect(result).toEqual({ message: `from-${name}`, model: name });
        expect(svc.generateCommitMessage).toHaveBeenCalledWith('prompt', progress, 2, opts);
        expect(generateViaOpenAICompatibleProvider).not.toHaveBeenCalled();
    });

    const compatCases: Provider[] = ['openai', 'codestral', 'openrouter', 'groq', 'deepseek', 'xai', 'custom'];

    it.each(compatCases)('routes %s through the OpenAI-compatible dispatcher', async (type) => {
        const opts = { maxTokens: 10 };
        const result = await AIServiceFactory.generateCommitMessage(type, 'prompt', progress, 2, opts);
        expect(result).toEqual({ message: `from-${type}`, model: type });
        expect(generateViaOpenAICompatibleProvider).toHaveBeenCalledWith(type, 'prompt', progress, 2, opts);
    });

    it('throws for an unsupported service type', async () => {
        await expect(
            AIServiceFactory.generateCommitMessage('bogus' as Provider, 'p', progress),
        ).rejects.toThrow(/AI service type 'bogus' is not supported/);
    });
});
