import { ConfigService } from '../utils/configService';
import { Logger } from '../utils/logger';
import { CommitMessage, ProgressReporter } from '../models/types';
import { PromptService } from './promptService';
import { TelemetryService } from './telemetryService';
import { errorMessages } from '../utils/constants';
import { removeThinkTags } from '../utils/textProcessing';
import { AIServiceFactory, AIServiceType } from './aiServiceFactory';
import { toError, sanitizeErrorForTelemetry } from '../utils/errorUtils';

// ~100k chars covers most diffs while staying within safe LLM API context window limits
const MAX_DIFF_LENGTH = 100000;

interface GenerateContext {
    fileCount?: number;
    onlyStagedChanges?: boolean;
}

export class AIService {
    static async generateCommitMessage(
        diff: string,
        blameAnalysis: string,
        progress: ProgressReporter,
        context: GenerateContext = {}
    ): Promise<CommitMessage> {
        if (!diff) {
            throw new Error(errorMessages.noChanges);
        }

        const provider = ConfigService.getProvider();
        const language = ConfigService.getCommitLanguage();
        const diffSize = diff.length;
        const truncated = diffSize > MAX_DIFF_LENGTH;

        TelemetryService.sendEvent({
            name: 'message_generation_started',
            diffSize,
            fileCount: context.fileCount ?? 0,
            truncated,
            provider,
        });

        const startTime = Date.now();
        const truncatedDiff = this.truncateDiff(diff);
        const prompt = await PromptService.generatePrompt(truncatedDiff, blameAnalysis, progress);

        progress.report({ message: "Generating commit message...", increment: 50 });

        try {
            const serviceType = provider as AIServiceType;
            const result = await AIServiceFactory.generateCommitMessage(serviceType, prompt, progress);

            // Post-process the commit message to remove think tags
            result.message = removeThinkTags(result.message);

            TelemetryService.sendEvent({
                name: 'message_generation_completed',
                provider,
                model: result.model,
                durationMs: Date.now() - startTime,
                language,
                onlyStagedChanges: context.onlyStagedChanges ?? false,
            });
            return result;
        } catch (error) {
            Logger.error('Failed to generate commit message:', toError(error));
            TelemetryService.sendEvent({
                name: 'message_generation_failed',
                provider,
                ...sanitizeErrorForTelemetry(toError(error)),
            });
            throw error;
        }
    }

    private static truncateDiff(diff: string): string {
        return diff.length > MAX_DIFF_LENGTH
            ? `${diff.substring(0, MAX_DIFF_LENGTH)}\n...(truncated)`
            : diff;
    }
}
