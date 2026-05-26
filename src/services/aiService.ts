import { ConfigService } from '../utils/configService';
import { CommitMessage, ProgressReporter } from '../models/types';
import { PromptService } from './promptService';
import { TelemetryService } from './telemetryService';
import { errorMessages } from '../utils/constants';
import { removeThinkTags } from '../utils/textProcessing';
import { AIServiceFactory, AIServiceType } from './aiServiceFactory';

// Fallback if `general.maxDiffSize` is unreadable. ~100k chars covers most
// diffs while staying within safe LLM API context window limits for major
// providers. Tighter caps (e.g. ~20k chars) are needed for low-TPM free
// tiers like Groq free — see the setting's description for guidance.
const DEFAULT_MAX_DIFF_LENGTH = 100000;

interface GenerateContext {
    fileCount?: number;
    onlyStagedChanges?: boolean;
    signal?: AbortSignal;
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
        const model = ConfigService.getModel();
        const language = ConfigService.get('commit.commitLanguage');
        const maxDiffLength = this.resolveMaxDiffLength();
        const diffSize = diff.length;
        const truncated = diffSize > maxDiffLength;

        TelemetryService.sendEvent({
            name: 'message_generation_started',
            diffSize,
            fileCount: context.fileCount ?? 0,
            truncated,
            provider,
            model,
        });

        const startTime = Date.now();
        const truncatedDiff = this.truncateDiff(diff, maxDiffLength);
        const prompt = await PromptService.generatePrompt(truncatedDiff, blameAnalysis, progress);

        progress.report({ message: 'Generating commit message...', increment: 50 });

        const serviceType = provider as AIServiceType;
        const result = await AIServiceFactory.generateCommitMessage(
            serviceType,
            prompt,
            progress,
            undefined,
            { signal: context.signal }
        );

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
    }

    private static truncateDiff(diff: string, maxDiffLength: number): string {
        return diff.length > maxDiffLength
            ? `${diff.substring(0, maxDiffLength)}\n...(truncated)`
            : diff;
    }

    /**
     * Read `general.maxDiffSize` and clamp to a sane range. `-1` disables
     * truncation (sends the whole diff regardless of size — only useful with
     * very-long-context models). Anything else is clamped to [1000, 1_000_000]
     * so a hand-edited project config can't either send an empty prompt or
     * overflow JSON.stringify.
     */
    private static resolveMaxDiffLength(): number {
        const raw = ConfigService.get('general.maxDiffSize');
        if (raw === -1) {
            return Number.POSITIVE_INFINITY;
        }
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
            return DEFAULT_MAX_DIFF_LENGTH;
        }
        return Math.max(1000, Math.min(1_000_000, raw));
    }
}
