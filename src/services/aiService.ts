import { ConfigService } from '../utils/configService';
import { CommitLintResult, CommitMessage, ProgressReporter } from '../models/types';
import { PromptService } from './promptService';
import { TelemetryService } from './telemetryService';
import { AIServiceFactory } from './aiServiceFactory';
import { blockPath, capBlameAnalysis, fileList, isNoisyPath, packFileBlocks, resolveMaxDiffLength, splitIntoFileBlocks, truncateDiff } from '../utils/diffTruncation';
import { Provider } from '../views/webview/protocol';
import { CommitLintService, CommitLintEngine } from './commitLintService';
import { Logger } from '../utils/logger';
import { redactDiffSecrets } from '../utils/errorUtils';
import { formatSupportsCommitlint } from '../utils/constants';

// Summary calls per generation for a diff over budget; a larger diff is
// truncated to this many budgets first.
const MAX_SUMMARY_CHUNKS = 4;

interface GenerateContext {
    fileCount?: number;
    onlyStagedChanges?: boolean;
    signal?: AbortSignal;
    /** The developer's own text from the commit box. */
    draft?: string;
    /** Commit Sage's own last message, still in the commit box on a re-run. */
    rejected?: string;
}

export class AIService {
    static async generateCommitMessage(
        repoPath: string,
        diff: string,
        blameAnalysis: string,
        progress: ProgressReporter,
        context: GenerateContext = {}
    ): Promise<CommitMessage> {
        const provider = ConfigService.getProvider();
        const model = ConfigService.getModel();
        const language = ConfigService.get('commit.commitLanguage');
        const maxDiffLength = resolveMaxDiffLength(ConfigService.get('general.maxDiffSize'));
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
        const commitFormat = ConfigService.get('commit.commitFormat');
        const commitlintEnabled = ConfigService.get('commit.commitlint.enabled') && formatSupportsCommitlint(commitFormat);
        // Extracted once per generation: the prompt and every refinement share
        // them, and the project engine spawns a CLI for each extraction.
        const rules = commitlintEnabled ? await PromptService.loadRules(repoPath, commitFormat, context.signal) : '';

        const maskedDiff = redactDiffSecrets(diff);
        if (maskedDiff !== diff) {
            Logger.log('Masked secrets in the diff before sending it to the model');
        }
        const summaries = truncated && ConfigService.get('general.summarizeLargeDiffs')
            ? await this.summarizeDiff(maskedDiff, maxDiffLength, provider, progress, context.signal)
            : undefined;
        const prompt = await PromptService.generatePrompt(
            repoPath, summaries ? '' : truncateDiff(maskedDiff, maxDiffLength), capBlameAnalysis(blameAnalysis, maxDiffLength), progress,
            { rules, draft: context.draft, rejected: context.rejected, summaries, signal: context.signal },
        );

        progress.report({ message: 'Generating commit message...', increment: 50 });

        let result = await AIServiceFactory.generateCommitMessage(
            provider,
            prompt,
            progress,
            { signal: context.signal }
        );

        if (commitlintEnabled) {
            result = await this.applyCommitLint(result, repoPath, commitFormat, rules, provider, progress, context);
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

    /**
     * Map step for a diff over budget: summarizes it in budget-sized parts,
     * one call each and in sequence (gentler on local models and rate
     * limits), so the message is written from every file rather than from a
     * truncated diff. Generated files are listed but not summarized.
     */
    private static async summarizeDiff(
        diff: string,
        maxDiffLength: number,
        provider: Provider,
        progress: ProgressReporter,
        signal?: AbortSignal,
    ): Promise<{ files: string; text: string } | undefined> {
        const blocks = splitIntoFileBlocks(diff);
        const meaningful = blocks.filter(block => !isNoisyPath(blockPath(block))).join('');
        const chunks = packFileBlocks(
            splitIntoFileBlocks(truncateDiff(meaningful, maxDiffLength * MAX_SUMMARY_CHUNKS)),
            maxDiffLength,
        );
        if (chunks.length === 0) {
            // Only generated files: the truncated diff already shows them all.
            return undefined;
        }
        const parts: string[] = [];
        for (const [i, chunk] of chunks.entries()) {
            progress.report({ message: `Summarizing changes (${i + 1}/${chunks.length})...` });
            const reply = await AIServiceFactory.generateCommitMessage(
                provider, PromptService.generateChunkSummaryPrompt(chunk), progress, { signal },
            );
            parts.push(reply.message);
        }
        return { files: fileList(blocks), text: parts.join('\n') };
    }

    private static async applyCommitLint(
        result: CommitMessage,
        repoPath: string,
        commitFormat: string,
        rules: string,
        provider: Provider,
        progress: ProgressReporter,
        context: GenerateContext
    ): Promise<CommitMessage> {
        const maxRetries = ConfigService.get('commit.commitlint.maxRetries');
        const rulesPath = ConfigService.get('commit.commitlint.rulesPath');
        const lintOpts = {
            engine: ConfigService.get('commit.commitlint.engine') as CommitLintEngine,
            signal: context.signal,
            format: commitFormat,
        };
        let attempt = 0;
        let signOff = false;

        while (attempt < maxRetries) {
            const { valid, errors, signOffRequired } = await this.validateWithAutoFix(result, repoPath, rulesPath, commitFormat, lintOpts);
            signOff = signOff || signOffRequired === true;

            if (valid) {
                break;
            }

            attempt++;
            if (attempt >= maxRetries) {
                Logger.warn(`CommitLint: max retries (${maxRetries}) reached, using message as-is`);
                break;
            }

            progress.report({ message: `CommitLint validation failed, refining… (${attempt}/${maxRetries})`, increment: 10 });

            result = await AIServiceFactory.generateCommitMessage(
                provider,
                PromptService.generateRefinementPrompt(result.message, errors, rules),
                progress,
                { signal: context.signal }
            );
        }

        return signOff ? { ...result, signOff } : result;
    }

    private static async validateWithAutoFix(
        result: CommitMessage,
        repoPath: string,
        rulesPath: string,
        commitFormat: string,
        lintOpts: { engine: CommitLintEngine; signal?: AbortSignal; format: string }
    ): Promise<CommitLintResult> {
        const lint = await CommitLintService.validate(result.message, repoPath, rulesPath, lintOpts);

        if (!lint.valid) {
            // Mechanical violations (casing, trailing period, blank line)
            // are fixed in code to save an LLM round-trip.
            const fixed = CommitLintService.autoFix(result.message, repoPath, rulesPath, commitFormat);
            if (fixed !== result.message) {
                result.message = fixed;
                return CommitLintService.validate(fixed, repoPath, rulesPath, lintOpts);
            }
        }

        return lint;
    }
}
