import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import type { CommitMessage, ProgressReporter, GenerateOptions } from '../models/types';
import { extractAndValidateMessage, getConfiguredTemperature, withRetryAndApiKeyGuard } from './baseAIService';
import { HttpUtils } from '../utils/httpUtils';
import { RetryUtils } from '../utils/retryUtils';
import { ApiKeyManager } from './apiKeyManager';

/**
 * Anthropic Messages API. NOT OpenAI-compatible:
 *  - URL: `POST https://api.anthropic.com/v1/messages`
 *  - Auth header: `x-api-key: <key>` (not `Authorization: Bearer ...`)
 *  - Versioning header: `anthropic-version: 2023-06-01` (required)
 *  - Body: `{model, max_tokens, system?, messages}` — `max_tokens` mandatory,
 *    `system` is a separate top-level field (not a message role)
 *  - Response: `{content: [{type: 'text', text: '...'}]}`
 *
 * The `anthropic-version` header is pinned to a stable date — bumping it
 * pulls in newer response shapes (e.g. cache_control fields) that the
 * extractor would have to handle.
 */
interface AnthropicResponse {
    content?: Array<{
        type?: string;
        text?: string;
    }>;
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicService {
    static async generateCommitMessage(
        prompt: string,
        progress: ProgressReporter,
        attempt: number = 1,
        options?: GenerateOptions,
    ): Promise<CommitMessage> {
        return withRetryAndApiKeyGuard(
            'Anthropic',
            prompt,
            progress,
            attempt,
            (p, pr, a) => this.generateCommitMessage(p, pr, a, options),
            async () => {
                const apiKey = await ApiKeyManager.getKey('anthropic');
                const model = ConfigService.get('anthropic.model');

                const payload = {
                    model,
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    max_tokens: options?.maxTokens ?? 1024,
                    temperature: getConfiguredTemperature(),
                    messages: [{ role: 'user', content: prompt }],
                };

                await RetryUtils.updateProgressForAttempt(progress, attempt);

                const data = await HttpUtils.postJson<AnthropicResponse>(
                    ANTHROPIC_API_URL,
                    payload,
                    {
                        headers: HttpUtils.createRequestHeaders(
                            apiKey,
                            // eslint-disable-next-line @typescript-eslint/naming-convention
                            { 'anthropic-version': ANTHROPIC_VERSION },
                            'x-api-key',
                        ),
                        signal: options?.signal,
                    },
                );

                progress.report({ message: 'Processing generated message...', increment: 90 });

                // First text block — Anthropic can interleave `text` and `tool_use`
                // blocks in `content[]`; we only ask for plain completion so
                // a single text block is expected, but find-first defends
                // against future API drift.
                const textBlock = data.content?.find(b => b?.type === 'text');
                const message = extractAndValidateMessage(
                    textBlock?.text,
                    'Anthropic',
                );
                Logger.log(`Commit message generated using ${model} model`);
                return { message, model };
            },
        );
    }
}
