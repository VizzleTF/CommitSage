import { ConfigService } from './configService';
import { CustomEndpointService } from './customEndpoint';
import { Logger } from './logger';
import { CommitMessage, ProgressReporter } from './types';
import { PromptService } from './promptService';

export class AIService {
    static async generateCommitMessage(
        diff: string,
        blameAnalysis: string,
        progress: ProgressReporter
    ): Promise<CommitMessage> {
        const language = ConfigService.getCommitLanguage();
        const messageLength = ConfigService.getCommitMessageLength();
        const truncatedDiff = this.truncateDiff(diff);
        const prompt = PromptService.generatePrompt(truncatedDiff, blameAnalysis, language, messageLength);

        progress.report({ message: "Generating commit message...", increment: 50 });

        try {
            if (ConfigService.useCustomEndpoint()) {
                return await CustomEndpointService.generateCommitMessage(prompt, progress);
            } else {
                return await this.generateWithGemini(prompt, progress);
            }
        } catch (error) {
            Logger.error('Failed to generate commit message:', error as Error);
            throw new Error(`Failed to generate commit message: ${(error as Error).message}`);
        }
    }

    private static truncateDiff(diff: string): string {
        const MAX_DIFF_LENGTH = 10000;
        if (diff.length > MAX_DIFF_LENGTH) {
            Logger.log(`Original diff length: ${diff.length}. Truncating to ${MAX_DIFF_LENGTH} characters.`);
            return `${diff.substring(0, MAX_DIFF_LENGTH)}\n...(truncated)`;
        }
        Logger.log(`Diff length: ${diff.length} characters`);
        return diff;
    }

    private static async generateWithGemini(
        prompt: string,
        progress: ProgressReporter
    ): Promise<CommitMessage> {
        // Implementation of Gemini API call
        // This is a placeholder and should be replaced with actual Gemini API integration
        return { message: "Placeholder commit message", model: "gemini-1.5-pro" };
    }
}