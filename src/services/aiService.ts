import { ConfigService } from '../utils/configService';
import { CommitLintResult, CommitMessage, ProgressReporter } from '../models/types';
import { PromptService } from './promptService';
import { TelemetryService } from './telemetryService';
import { AIServiceFactory } from './aiServiceFactory';
import { capBlameAnalysis, resolveMaxDiffLength, truncateDiff } from '../utils/diffTruncation';
import { Provider } from '../views/webview/protocol';
import { CommitLintService, CommitLintEngine } from './commitLintService';
import { Logger } from '../utils/logger';
import { redactDiffSecrets } from '../utils/errorUtils';
import { formatSupportsCommitlint } from '../utils/constants';

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
        const truncatedDiff = truncateDiff(maskedDiff, maxDiffLength);
        const prompt = await PromptService.generatePrompt(
            repoPath, truncatedDiff, capBlameAnalysis(blameAnalysis, maxDiffLength), progress, rules,
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
