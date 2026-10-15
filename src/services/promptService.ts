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

// A draft is a commit message, not a document: the cap keeps a pasted log
// from crowding out the diff.
export const MAX_DRAFT_LENGTH = 2000;

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
    private static resolveTemplate(format: CommitFormat, progress: ProgressReporter, signal?: AbortSignal): Promise<string> {
        const commitLanguage = ConfigService.get('commit.commitLanguage');
        if (commitLanguage === 'custom') {
            return CustomLanguageService.getTemplate(format, ConfigService.get('commit.customLanguageName'), progress, signal);
        }
        return Promise.resolve(getTemplate(format, commitLanguage as CommitLanguage));
    }

    private static languagePrompt(): string {
        const commitLanguage = ConfigService.get('commit.commitLanguage');
        if (commitLanguage === 'custom') {
            const customLanguageName = ConfigService.get('commit.customLanguageName');
            return customLanguageName.trim()
                ? `Please write the commit message in ${customLanguageName}.`
                : LANGUAGE_PROMPTS.english;
        }
        return LANGUAGE_PROMPTS[commitLanguage as Exclude<CommitLanguage, 'custom'>] ?? LANGUAGE_PROMPTS.english;
    }

    /**
     * The active commitlint rule set as prompt text. The caller loads it once
     * per generation and passes it to `generatePrompt` (appended to the format
     * template) and `generateRefinementPrompt` (listed for the fix-up).
     */
    static loadRules(repoPath: string, format: string, signal?: AbortSignal): Promise<string> {
        const rulesPath = ConfigService.get('commit.commitlint.rulesPath');
        const engine = ConfigService.get('commit.commitlint.engine') as CommitLintEngine;
        return CommitLintService.extractRules(repoPath, rulesPath, { engine, format, signal });
    }

    /** Joins the prompt sections; an empty language prompt, examples or draft block is left out. */
    private static buildPrompt(mainInstructions: string, languagePrompt: string, diff: string, blameAnalysis: string, reminder: string, examplesBlock = '', draftBlock = ''): string {
        return [
            mainInstructions,
            examplesBlock,
            languagePrompt,
            `Git diff to analyze:\n${diff}`,
            `Git blame analysis:\n${blameAnalysis}`,
            draftBlock,
            reminder,
            'Please provide ONLY the commit message, without any additional text or explanations.',
        ].filter(Boolean).join('\n\n');
    }

    /**
     * Recent commit messages to feed as style examples, when the user enabled
     * `useRecentCommitsAsContext` or picked the `previous` format. Empty when
     * disabled or when the repo has no usable history (best-effort context).
     */
    private static loadRecentCommitExamples(repoPath: string, formatSetting: string, signal?: AbortSignal): Promise<string[]> {
        const enabled = ConfigService.get('commit.useRecentCommitsAsContext') || formatSetting === 'previous';
        if (!enabled) {
            return Promise.resolve([]);
        }
        const count = ConfigService.get('commit.recentCommitsCount');
        const scope = ConfigService.get('commit.recentCommitsScope') as 'all' | 'mine';
        return GitService.getRecentCommitMessages(repoPath, count, scope, signal);
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

    /**
     * What the developer already typed in the commit box, framed as intent:
     * the model keeps what it says and fixes how it is written.
     */
    private static buildDraftBlock(draft: string): string {
        const text = draft.trim().slice(0, MAX_DRAFT_LENGTH);
        if (!text) {
            return '';
        }
        return 'The developer started this commit message. Keep the intent and facts of the draft, '
            + 'use the diff for what it leaves out, and rewrite it in the required format and language:\n'
            + `<developer_draft>\n${text}\n</developer_draft>`;
    }

    /**
     * @param rules commitlint rules from `loadRules`, or '' when validation is
     *   off — they ride along with the format template so the model sees
     *   exactly what the validator will check.
     * @param draft the developer's text from the commit box, or '' for none.
     * @param signal cancels the git log read and a custom-language translation.
     */
    static async generatePrompt(repoPath: string, diff: string, blameAnalysis: string, progress: ProgressReporter, rules = '', draft = '', signal?: AbortSignal): Promise<string> {
        const useCustomInstructions = ConfigService.get('commit.useCustomInstructions');
        const customInstructions = ConfigService.get('commit.customInstructions');
        const draftBlock = this.buildDraftBlock(draft);

        if (useCustomInstructions && customInstructions.trim()) {
            return this.buildPrompt(customInstructions, '', diff, blameAnalysis, STRICT_FORMAT_REMINDER, '', draftBlock);
        }

        const formatSetting = ConfigService.get('commit.commitFormat');
        const examples = await this.loadRecentCommitExamples(repoPath, formatSetting, signal);

        // `custom` without usable instructions has no template of its own, and
        // `previous` needs example commits to define its style; both fall back
        // to the conventional template (for `previous`, so we don't ask the
        // model to "match" an empty set).
        const format: CommitFormat = formatSetting === 'custom' || (formatSetting === 'previous' && examples.length === 0)
            ? 'conventional'
            : formatSetting as CommitFormat;

        const template = await this.resolveTemplate(format, progress, signal);
        const reminder = format === 'detailed' ? DETAILED_FORMAT_REMINDER : STRICT_FORMAT_REMINDER;
        const mainInstructions = rules ? `${template}\n\n${rules}` : template;

        const examplesBlock = this.buildExamplesBlock(examples, formatSetting !== 'previous');
        return this.buildPrompt(mainInstructions, this.languagePrompt(), diff, blameAnalysis, reminder, examplesBlock, draftBlock);
    }

    static generateRefinementPrompt(originalMessage: string, errors: string[], rules: string): string {
        // Full rule set included so the model doesn't fix one rule while breaking another
        return `The following commit message failed validation:

${originalMessage}

Validation errors:
${errors.map(e => `- ${e}`).join('\n')}

${rules}

Rewrite the commit message fixing all the errors above while keeping every rule satisfied.
${this.languagePrompt()}

${STRICT_FORMAT_REMINDER}

Please provide ONLY the corrected commit message, without any additional text or explanations.
`;
    }
}
