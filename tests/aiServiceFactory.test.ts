import { describe, it, expect, vi, beforeEach } from 'vitest';

const make = (name: string) => ({
    generateCommitMessage: vi.fn(async () => ({ message: `from-${name}`, model: name })),
});

const {
    GeminiService, OpenAIService, CodestralService, OllamaService,
    GroqService, OpenRouterService, AnthropicService, DeepSeekService,
    XaiService, CustomOpenAIService,
} = vi.hoisted(() => ({
    GeminiService: { generateCommitMessage: undefined as never },
    OpenAIService: { generateCommitMessage: undefined as never },
    CodestralService: { generateCommitMessage: undefined as never },
    OllamaService: { generateCommitMessage: undefined as never },
    GroqService: { generateCommitMessage: undefined as never },
    OpenRouterService: { generateCommitMessage: undefined as never },
    AnthropicService: { generateCommitMessage: undefined as never },
    DeepSeekService: { generateCommitMessage: undefined as never },
    XaiService: { generateCommitMessage: undefined as never },
    CustomOpenAIService: { generateCommitMessage: undefined as never },
}));

vi.mock('../src/services/geminiService', () => ({ GeminiService }));
vi.mock('../src/services/openaiService', () => ({ OpenAIService }));
vi.mock('../src/services/codestralService', () => ({ CodestralService }));
vi.mock('../src/services/ollamaService', () => ({ OllamaService }));
vi.mock('../src/services/groqService', () => ({ GroqService }));
vi.mock('../src/services/openRouterService', () => ({ OpenRouterService }));
vi.mock('../src/services/anthropicService', () => ({ AnthropicService }));
vi.mock('../src/services/deepSeekService', () => ({ DeepSeekService }));
vi.mock('../src/services/xaiService', () => ({ XaiService }));
vi.mock('../src/services/customOpenAIService', () => ({ CustomOpenAIService }));

import { AIServiceFactory, AIServiceType } from '../src/services/aiServiceFactory';

const progress = { report: () => undefined };

beforeEach(() => {
    Object.assign(GeminiService, make('gemini'));
    Object.assign(OpenAIService, make('openai'));
    Object.assign(CodestralService, make('codestral'));
    Object.assign(OllamaService, make('ollama'));
    Object.assign(GroqService, make('groq'));
    Object.assign(OpenRouterService, make('openrouter'));
    Object.assign(AnthropicService, make('anthropic'));
    Object.assign(DeepSeekService, make('deepseek'));
    Object.assign(XaiService, make('xai'));
    Object.assign(CustomOpenAIService, make('custom'));
});

describe('AIServiceFactory.generateCommitMessage routing', () => {
    const cases: Array<[AIServiceType, { generateCommitMessage: ReturnType<typeof vi.fn> }, string]> = [
        [AIServiceType.GEMINI, GeminiService as never, 'gemini'],
        [AIServiceType.OPENAI, OpenAIService as never, 'openai'],
        [AIServiceType.CODESTRAL, CodestralService as never, 'codestral'],
        [AIServiceType.OLLAMA, OllamaService as never, 'ollama'],
        [AIServiceType.OPENROUTER, OpenRouterService as never, 'openrouter'],
        [AIServiceType.GROQ, GroqService as never, 'groq'],
        [AIServiceType.ANTHROPIC, AnthropicService as never, 'anthropic'],
        [AIServiceType.DEEPSEEK, DeepSeekService as never, 'deepseek'],
        [AIServiceType.XAI, XaiService as never, 'xai'],
        [AIServiceType.CUSTOM, CustomOpenAIService as never, 'custom'],
    ];

    it.each(cases)('routes %s to the right service', async (type, svc, name) => {
        const opts = { maxTokens: 10 };
        const result = await AIServiceFactory.generateCommitMessage(type, 'prompt', progress, 2, opts);
        expect(result).toEqual({ message: `from-${name}`, model: name });
        expect(svc.generateCommitMessage).toHaveBeenCalledWith('prompt', progress, 2, opts);
    });

    it('throws for an unsupported service type', async () => {
        await expect(
            AIServiceFactory.generateCommitMessage('bogus' as AIServiceType, 'p', progress),
        ).rejects.toThrow(/AI service type 'bogus' is not supported/);
    });
});
