import { Logger } from '../utils/logger';
import type { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { extractAndValidateMessage, getConfiguredTemperature, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';

interface OpenAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

/**
 * Single request to an OpenAI-compatible `chat/completions` endpoint.
 * Used by OpenAI, Groq, OpenRouter, DeepSeek, xAI, and the user-configurable
 * "Custom" provider — every vendor that mirrors OpenAI's wire format.
 *
 * Anthropic is NOT OpenAI-compatible (different request/response shape,
 * `x-api-key` header style) — see `anthropicService.ts`.
 */
export interface OpenAICompatibleRequest {
    providerLabel: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    chatCompletionsPath?: string;
    extraHeaders?: Record<string, string>;
}

export async function generateViaOpenAICompatible(
    request: OpenAICompatibleRequest,
    prompt: string,
    progress: ProgressReporter,
    attempt: number,
    retryFn: (
        prompt: string,
        progress: ProgressReporter,
        attempt: number,
    ) => Promise<CommitMessage>,
    options?: GenerateOptions,
): Promise<CommitMessage> {
    return withRetryAndApiKeyGuard(
        request.providerLabel,
        prompt,
        progress,
        attempt,
        retryFn,
        async () => {
            const path = request.chatCompletionsPath ?? '/chat/completions';
            const baseUrl = HttpUtils.stripTrailingSlashes(request.baseUrl);

            const payload = {
                model: request.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: getConfiguredTemperature(),
                // eslint-disable-next-line @typescript-eslint/naming-convention
                max_tokens: options?.maxTokens ?? 1024,
            };

            await RetryUtils.updateProgressForAttempt(progress, attempt);

            const data = await HttpUtils.postJson<OpenAIResponse>(
                `${baseUrl}${path}`,
                payload,
                {
                    headers: HttpUtils.createRequestHeaders(
                        request.apiKey,
                        request.extraHeaders,
                    ),
                    signal: options?.signal,
                },
            );

            progress.report({ message: 'Processing generated message...', increment: 90 });

            const message = extractAndValidateMessage(
                data.choices?.[0]?.message?.content,
                request.providerLabel,
            );
            Logger.log(`Commit message generated using ${request.model} model`);
            return { message, model: request.model };
        },
    );
}
