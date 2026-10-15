import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError } from '../src/utils/httpUtils';

const { mockedPostJson } = vi.hoisted(() => ({ mockedPostJson: vi.fn() }));

vi.mock('../src/utils/httpUtils', async () => {
    const actual = await vi.importActual<typeof import('../src/utils/httpUtils')>(
        '../src/utils/httpUtils'
    );
    return {
        ...actual,
        HttpUtils: {
            createRequestHeaders: actual.HttpUtils.createRequestHeaders,
            stripTrailingSlashes: actual.HttpUtils.stripTrailingSlashes,
            postJson: mockedPostJson,
        },
    };
});

vi.mock('../src/services/apiKeyManager', () => ({
    ApiKeyManager: {
        getKey: vi.fn(async () => 'test-key'),
        getOptionalKey: vi.fn(async () => undefined),
    },
}));

const SETTINGS: Record<string, unknown> = {};

vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => SETTINGS[key],
        getModelFor: (provider: string) => SETTINGS[`${provider}.model`],
    },
}));

vi.mock('../src/utils/retryUtils', () => ({
    RetryUtils: {
        updateProgressForAttempt: vi.fn(),
        handleGenerationError: vi.fn(async (err: Error) => {
            throw err;
        }),
    },
}));

import { nextThinkingStep } from '../src/services/baseAIService';
import { AnthropicService } from '../src/services/anthropicService';
import { OllamaService } from '../src/services/ollamaService';
import { generateViaOpenAICompatibleProvider } from '../src/services/openAICompatibleService';

const progress = { report: () => undefined };

/** Request body of the Nth `postJson` call. */
function payloadOf(call: number): Record<string, unknown> {
    return mockedPostJson.mock.calls[call][1] as Record<string, unknown>;
}

const OPENAI_OK = { choices: [{ message: { content: 'feat: ok' } }] };

beforeEach(() => {
    mockedPostJson.mockReset();
    for (const key of Object.keys(SETTINGS)) {
        delete SETTINGS[key];
    }
    Object.assign(SETTINGS, {
        'general.disableThinking': true,
        'general.temperature': -1,
        'openai.baseUrl': 'https://api.openai.com/v1',
        'ollama.baseUrl': 'http://localhost:11434',
    });
});

describe('nextThinkingStep', () => {
    const ladder = [{ thinking: 'a' }, { thinking: 'b' }, { effort: 'low' }];

    it('moves one step down on a 400 that names the field', () => {
        const error = new HttpError(400, { error: { message: "thinking.type: 'a' is not supported" } });
        expect(nextThinkingStep(error, ladder, 0)).toBe(1);
    });

    it('skips every step with the same field when the field is unknown', () => {
        const error = new HttpError(400, { error: { message: "Unsupported parameter: 'thinking'" } });
        expect(nextThinkingStep(error, ladder, 0)).toBe(2);
    });

    it('moves down on a 400 that only quotes the sent value', () => {
        const effort = [{ reasoning_effort: 'minimal' }, { reasoning_effort: 'low' }];
        const error = new HttpError(400, { error: {
            message: "Unsupported value: 'minimal' is not supported with the 'gpt-5.6-sol' model. Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.",
        } });
        expect(nextThinkingStep(error, effort, 0)).toBe(1);
    });

    it('leaves other errors alone', () => {
        expect(nextThinkingStep(new HttpError(400, { error: { message: 'messages: too long' } }), ladder, 0)).toBeUndefined();
        expect(nextThinkingStep(new HttpError(500, 'thinking failed'), ladder, 0)).toBeUndefined();
        expect(nextThinkingStep(new Error('thinking'), ladder, 0)).toBeUndefined();
    });

    it('stops past the last step', () => {
        expect(nextThinkingStep(new HttpError(400, 'thinking'), ladder, 3)).toBeUndefined();
    });
});

describe('general.disableThinking off', () => {
    it('sends no thinking field', async () => {
        SETTINGS['general.disableThinking'] = false;
        SETTINGS['anthropic.model'] = 'claude-off';
        mockedPostJson.mockResolvedValueOnce({ content: [{ type: 'text', text: 'feat: ok' }] });
        await AnthropicService.generateCommitMessage('p', progress);
        expect(payloadOf(0)).not.toHaveProperty('thinking');
        expect(payloadOf(0)).not.toHaveProperty('output_config');
    });
});

describe('Anthropic thinking ladder', () => {
    it('disables thinking, then falls back to between_tools and low effort, and remembers the step', async () => {
        SETTINGS['anthropic.model'] = 'claude-always-thinks';
        mockedPostJson
            .mockRejectedValueOnce(new HttpError(400, { type: 'error', error: { type: 'invalid_request_error', message: '"thinking.type.disabled" is not supported for this model' } }))
            .mockRejectedValueOnce(new HttpError(400, { error: { message: 'thinking.type: between_tools is not supported' } }))
            .mockResolvedValueOnce({ content: [{ type: 'text', text: 'feat: ok' }] })
            .mockResolvedValueOnce({ content: [{ type: 'text', text: 'feat: again' }] });

        const result = await AnthropicService.generateCommitMessage('p', progress);
        expect(result.message).toBe('feat: ok');
        expect(payloadOf(0)).toMatchObject({ thinking: { type: 'disabled' } });
        expect(payloadOf(1)).toMatchObject({ thinking: { type: 'between_tools' } });
        expect(payloadOf(2)).toMatchObject({ output_config: { effort: 'low' } });
        expect(payloadOf(2)).not.toHaveProperty('thinking');

        await AnthropicService.generateCommitMessage('p', progress);
        expect(mockedPostJson).toHaveBeenCalledTimes(4);
        expect(payloadOf(3)).toMatchObject({ output_config: { effort: 'low' } });
    });

    it('lets an unrelated 400 through', async () => {
        SETTINGS['anthropic.model'] = 'claude-bad-request';
        mockedPostJson.mockRejectedValueOnce(new HttpError(400, { error: { message: 'messages: empty' } }));
        await expect(AnthropicService.generateCommitMessage('p', progress)).rejects.toThrow();
        expect(mockedPostJson).toHaveBeenCalledTimes(1);
    });
});

describe('OpenAI-compatible thinking ladder', () => {
    it('steps reasoning_effort down from none to minimal', async () => {
        SETTINGS['openai.model'] = 'gpt-5-test';
        mockedPostJson
            .mockRejectedValueOnce(new HttpError(400, { error: {
                param: 'reasoning_effort',
                message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model.",
            } }))
            .mockResolvedValueOnce(OPENAI_OK);

        await generateViaOpenAICompatibleProvider('openai', 'p', progress);
        expect(payloadOf(0)).toMatchObject({ reasoning_effort: 'none' });
        expect(payloadOf(1)).toMatchObject({ reasoning_effort: 'minimal' });
    });

    it('drops reasoning_effort entirely for a model without it', async () => {
        SETTINGS['openai.model'] = 'gpt-4o-test';
        mockedPostJson
            .mockRejectedValueOnce(new HttpError(400, { error: {
                param: 'reasoning_effort',
                message: "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
            } }))
            .mockResolvedValueOnce(OPENAI_OK);

        await generateViaOpenAICompatibleProvider('openai', 'p', progress);
        expect(mockedPostJson).toHaveBeenCalledTimes(2);
        expect(payloadOf(1)).not.toHaveProperty('reasoning_effort');
    });

    it('sends nothing for a provider without a switch', async () => {
        SETTINGS['codestral.model'] = 'codestral-latest';
        mockedPostJson.mockResolvedValueOnce(OPENAI_OK);
        await generateViaOpenAICompatibleProvider('codestral', 'p', progress);
        expect(Object.keys(payloadOf(0)).sort()).toEqual(['max_tokens', 'messages', 'model']);
    });
});

describe('Ollama thinking ladder', () => {
    it('sends think: false', async () => {
        SETTINGS['ollama.model'] = 'qwen3';
        mockedPostJson.mockResolvedValueOnce({ message: { content: 'feat: ok' } });
        await OllamaService.generateCommitMessage('p', progress);
        expect(payloadOf(0)).toMatchObject({ think: false });
    });

});
