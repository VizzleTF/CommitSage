import { CommitFormat, getTemplate } from '../templates';
import { ConfigService } from '../utils/configService';
import { CommitLintService, CommitLintEngine } from './commitLintService';
import { CustomLanguageService } from './customLanguageService';
import { GitService } from './gitService';
import type { CommitLanguage } from '../utils/constants';
import type { ProgressReporter } from '../models/types';

const STRICT_FORMAT_REMINDER = `STRICT OUTPUT RULES — these override any tendency to be verbose, even on large diffs:
- Write ONE commit message a reviewer can understand without reading the diff.
- Output ONLY the commit message. No preamble, no explanation, no closing remark.
- No markdown bold (**text**), no headings, no code fences.
- First (subject) line MUST stay within the format's character limit (typically 50).
- Body bullets MUST start with "- ", each ≤ 50 chars, max 5 bullets total.
- Explain WHY the change was made — its intent, the problem it solves, or its effect — not a line-by-line restatement of the diff.
- Do not list every changed file; summarise.
- Produce exactly ONE commit message for the whole diff, even when it spans multiple files or concerns.`;

// The `detailed` format intentionally violates several of the strict rules
// (multi-line subject, longer bullets, listing changed files). Use a softer
// reminder that still suppresses preamble/explanation.
const DETAILED_FORMAT_REMINDER = `STRICT OUTPUT RULES:
- Output ONLY the commit message. No preamble, no explanation, no closing remark.
- No markdown bold (**text**), no headings, no code fences.
- Follow the Summary/Details/Effects template exactly.
- Capture WHY the change was made (its intent and effect) in the Summary, not just what changed.
- Produce exactly ONE commit message for the whole diff.`;

const LANGUAGE_PROMPTS: Record<Exclude<CommitLanguage, 'custom'>, string> = {
    english: 'Please write the commit message in English.',
    russian: 'Пожалуйста, напиши сообщение коммита на русском языке.',
    chinese: '请用中文写提交信息。',
    japanese: 'コミットメッセージを日本語で書いてください。',
    spanish: 'Por favor, escribe el mensaje del commit en español.',
    korean: '커밋 메시지를 한국어로 작성해 주세요.',
    german: 'Bitte schreiben Sie die Commit-Nachricht auf Deutsch.',
    french: 'Veuillez rédiger le message de commit en français.',
    portuguese: 'Por favor, escreva a mensagem do commit em português brasileiro.',
};

export class PromptService {
    private static async resolveLanguagePrompt(format: CommitFormat, progress: ProgressReporter): Promise<{ template: string; languagePrompt: string }> {
        const commitLanguage = ConfigService.get('commit.commitLanguage');

        let template: string;
        let languagePrompt: string;

        if (commitLanguage === 'custom') {
            const customLanguageName = ConfigService.get('commit.customLanguageName');
            template = await CustomLanguageService.getTemplate(format, customLanguageName, progress);
            languagePrompt = customLanguageName.trim()
                ? `Please write the commit message in ${customLanguageName}.`
                : LANGUAGE_PROMPTS.english;
        } else {
            const lang = commitLanguage as Exclude<CommitLanguage, 'custom'>;
            template = getTemplate(format, lang);
            languagePrompt = LANGUAGE_PROMPTS[lang] ?? LANGUAGE_PROMPTS.english;
        }

        return { template, languagePrompt };
    }

    /**
     * Resolve the active commitlint rule set as prompt text. Shared by
     * `generatePrompt` (appends it to the format template) and
     * `generateRefinementPrompt` (lists it for the fix-up), which previously
     * each hand-read `rulesPath` + `engine` and called `extractRules`.
     */
    private static loadRules(repoPath: string, format: string): Promise<string> {
        const rulesPath = ConfigService.get('commit.commitlint.rulesPath');
        const engine = ConfigService.get('commit.commitlint.engine') as CommitLintEngine;
        return CommitLintService.extractRules(repoPath, rulesPath, { engine, format });
    }

    private static buildPrompt(mainInstructions: string, languagePrompt: string, diff: string, blameAnalysis: string, reminder: string, examplesBlock = ''): string {
        const examplesSection = examplesBlock ? `${examplesBlock}\n\n` : '';
        return `
${mainInstructions}

${examplesSection}${languagePrompt}

Git diff to analyze:
${diff}

Git blame analysis:
${blameAnalysis}

${reminder}

Please provide ONLY the commit message, without any additional text or explanations.
`;
    }

    /**
     * Recent commit messages to feed as style examples, when the user enabled
     * `useRecentCommitsAsContext` or picked the `previous` format. Empty when
     * disabled or when the repo has no usable history (best-effort context).
     */
    private static loadRecentCommitExamples(repoPath: string, formatSetting: string): Promise<string[]> {
        const enabled = ConfigService.get('commit.useRecentCommitsAsContext') || formatSetting === 'previous';
        if (!enabled) {
            return Promise.resolve([]);
        }
        const count = ConfigService.get('commit.recentCommitsCount');
        const scope = ConfigService.get('commit.recentCommitsScope') as 'all' | 'mine';
        return GitService.getRecentCommitMessages(repoPath, count, scope);
    }

    /**
     * Render the example commits. When the format leads (any format other than
     * `previous`) they are framed as a style reference that must not override the
     * structural rules; for `previous` the examples ARE the spec.
     */
    private static buildExamplesBlock(examples: string[], formatLeads: boolean): string {
        if (examples.length === 0) {
            return '';
        }
        const lead = formatLeads
            ? 'Recent commit messages from this repository, as a STYLE reference only (the format rules above take precedence on structure):'
            : 'Recent commit messages from this repository — match their style, tone, scope, and structure:';
        return `${lead}\n\n${examples.join('\n\n---\n\n')}`;
    }

    static async generatePrompt(repoPath: string, diff: string, blameAnalysis: string, progress: ProgressReporter): Promise<string> {
        const useCustomInstructions = ConfigService.get('commit.useCustomInstructions');
        const customInstructions = ConfigService.get('commit.customInstructions');
        const formatSetting = ConfigService.get('commit.commitFormat');

        if (useCustomInstructions && customInstructions.trim()) {
            return `${customInstructions}

Git diff to analyze:
${diff}

Git blame analysis:
${blameAnalysis}

${STRICT_FORMAT_REMINDER}

Please provide ONLY the commit message, without any additional text or explanations.`;
        }

        const examples = await this.loadRecentCommitExamples(repoPath, formatSetting);

        // `previous` needs example commits to define its style; with no usable
        // history fall back to the conventional template so we don't ask the
        // model to "match" an empty set.
        const effectiveFormat = formatSetting === 'previous' && examples.length === 0
            ? 'conventional'
            : formatSetting;
        const format = effectiveFormat as CommitFormat;

        const { template, languagePrompt } = await this.resolveLanguagePrompt(format, progress);

        const reminder = format === 'detailed' ? DETAILED_FORMAT_REMINDER : STRICT_FORMAT_REMINDER;

        // Validation enabled → the active rule set rides along with the format
        // template, so the model sees exactly what the validator will check.
        // `previous` has no fixed structure to validate, so it skips rules too.
        let mainInstructions = template;
        if (ConfigService.get('commit.commitlint.enabled') && formatSetting !== 'custom' && formatSetting !== 'previous') {
            const rules = await this.loadRules(repoPath, formatSetting);
            mainInstructions = `${template}\n\n${rules}`;
        }

        const examplesBlock = this.buildExamplesBlock(examples, formatSetting !== 'previous');
        return this.buildPrompt(mainInstructions, languagePrompt, diff, blameAnalysis, reminder, examplesBlock);
    }

    static async generateRefinementPrompt(repoPath: string, originalMessage: string, errors: string[], progress: ProgressReporter): Promise<string> {
        const formatSetting = ConfigService.get('commit.commitFormat');
        const format = (formatSetting === 'custom' ? 'conventional' : formatSetting) as CommitFormat;
        const { languagePrompt } = await this.resolveLanguagePrompt(format, progress);

        // Full rule set included so the model doesn't fix one rule while breaking another
        const rules = await this.loadRules(repoPath, formatSetting);

        return `The following commit message failed validation:

${originalMessage}

Validation errors:
${errors.map(e => `- ${e}`).join('\n')}

${rules}

Rewrite the commit message fixing all the errors above while keeping every rule satisfied.
${languagePrompt}

${STRICT_FORMAT_REMINDER}

Please provide ONLY the corrected commit message, without any additional text or explanations.
`;
    }
}