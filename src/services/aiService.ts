import { ConfigService } from '../utils/configService';
import { CommitMessage, ProgressReporter } from '../models/types';
import { PromptService } from './promptService';
import { TelemetryService } from './telemetryService';
import { errorMessages } from '../utils/constants';
import { removeThinkTags } from '../utils/textProcessing';
import { AIServiceFactory } from './aiServiceFactory';
import { truncateDiff } from '../utils/diffTruncation';
import { Provider } from '../views/webview/protocol';
import { CommitLintService, CommitLintEngine } from './commitLintService';
import { Logger } from '../utils/logger';

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
        repoPath: string,
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
        const truncatedDiff = truncateDiff(diff, maxDiffLength);
        const prompt = await PromptService.generatePrompt(repoPath, truncatedDiff, blameAnalysis, progress);

        progress.report({ message: 'Generating commit message...', increment: 50 });

        const serviceType = provider as Provider;
        let result = await AIServiceFactory.generateCommitMessage(
            serviceType,
            prompt,
            progress,
            undefined,
            { signal: context.signal }
        );

        result.message = removeThinkTags(result.message);

        const commitFormat = ConfigService.get('commit.commitFormat');
        // Validation never applies to free-form custom prompts or the
        // history-driven `previous` format (neither has a fixed structure).
        const commitlintEnabled = ConfigService.get('commit.commitlint.enabled')
            && commitFormat !== 'custom'
            && commitFormat !== 'previous';
        if (commitlintEnabled) {
            result = await this.applyCommitLint(result, repoPath, commitFormat, serviceType, progress, context);
        }

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

    private static async applyCommitLint(
        result: CommitMessage,
        repoPath: string,
        commitFormat: string,
        serviceType: Provider,
        progress: ProgressReporter,
        context: GenerateContext
    ): Promise<CommitMessage> {
        const maxRetries = ConfigService.get('commit.commitlint.maxRetries');
        let attempt = 0;

        while (attempt < maxRetries) {
            const rulesPath = ConfigService.get('commit.commitlint.rulesPath');
            const lintOpts = {
                engine: ConfigService.get('commit.commitlint.engine') as CommitLintEngine,
                signal: context.signal,
                format: commitFormat,
            };
            const { valid, errors } = await this.validateWithAutoFix(result, repoPath, rulesPath, commitFormat, lintOpts);

            if (valid) {
                break;
            }

            attempt++;
            if (attempt >= maxRetries) {
                Logger.warn(`CommitLint: max retries (${maxRetries}) reached, using message as-is`);
                break;
            }

            progress.report({ message: `CommitLint validation failed, refining… (${attempt}/${maxRetries})`, increment: 10 });

            const refinementPrompt = await PromptService.generateRefinementPrompt(repoPath, result.message, errors, progress);
            const refined = await AIServiceFactory.generateCommitMessage(
                serviceType,
                refinementPrompt,
                progress,
                undefined,
                { signal: context.signal }
            );

            result = { ...refined, message: removeThinkTags(refined.message) };
        }

        return result;
    }

    private static async validateWithAutoFix(
        result: CommitMessage,
        repoPath: string,
        rulesPath: string,
        commitFormat: string,
        lintOpts: { engine: CommitLintEngine; signal?: AbortSignal; format: string }
    ): Promise<{ valid: boolean; errors: string[] }> {
        let { valid, errors } = await CommitLintService.validate(result.message, repoPath, rulesPath, lintOpts);

        if (!valid) {
            // Mechanical violations (casing, trailing period, blank line)
            // are fixed in code to save an LLM round-trip.
            const fixed = CommitLintService.autoFix(result.message, repoPath, rulesPath, commitFormat);
            if (fixed !== result.message) {
                result.message = fixed;
                ({ valid, errors } = await CommitLintService.validate(fixed, repoPath, rulesPath, lintOpts));
            }
        }

        return { valid, errors };
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
