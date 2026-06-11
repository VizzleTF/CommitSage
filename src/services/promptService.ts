import { CommitFormat, getTemplate } from '../templates';
import { ConfigService } from '../utils/configService';
import { CommitLintService } from './commitLintService';
import { CustomLanguageService } from './customLanguageService';
import type { CommitLanguage } from '../utils/constants';
import type { ProgressReporter } from '../models/types';

const STRICT_FORMAT_REMINDER = `STRICT OUTPUT RULES — these override any tendency to be verbose, even on large diffs:
- Output ONLY the commit message. No preamble, no explanation, no closing remark.
- No markdown bold (**text**), no headings, no code fences.
- First (subject) line MUST stay within the format's character limit (typically 50).
- Body bullets MUST start with "- ", each ≤ 50 chars, max 5 bullets total.
- Do not list every changed file; summarise.`;

// The `detailed` format intentionally violates several of the strict rules
// (multi-line subject, longer bullets, listing changed files). Use a softer
// reminder that still suppresses preamble/explanation.
const DETAILED_FORMAT_REMINDER = `STRICT OUTPUT RULES:
- Output ONLY the commit message. No preamble, no explanation, no closing remark.
- No markdown bold (**text**), no headings, no code fences.
- Follow the Summary/Details/Effects template exactly.`;

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

    private static buildPrompt(mainInstructions: string, languagePrompt: string, diff: string, blameAnalysis: string, reminder: string): string {
        return `
${mainInstructions}

${languagePrompt}

Git diff to analyze:
${diff}

Git blame analysis:
${blameAnalysis}

${reminder}

Please provide ONLY the commit message, without any additional text or explanations.
`;
    }

    static async generatePrompt(repoPath: string, diff: string, blameAnalysis: string, progress: ProgressReporter): Promise<string> {
        const useCustomInstructions = ConfigService.get('commit.useCustomInstructions');
        const customInstructions = ConfigService.get('commit.customInstructions');

        if (useCustomInstructions && customInstructions.trim()) {
            return `${customInstructions}

Git diff to analyze:
${diff}

Git blame analysis:
${blameAnalysis}

${STRICT_FORMAT_REMINDER}

Please provide ONLY the commit message, without any additional text or explanations.`;
        }

        const format = ConfigService.get('commit.commitFormat') as CommitFormat;

        const { template, languagePrompt } = await this.resolveLanguagePrompt(format, progress);

        if (ConfigService.get('commit.commitlint.enabled')) {
            const rulesPath = ConfigService.get('commit.commitlint.rulesPath');
            const rules = CommitLintService.extractRules(repoPath, rulesPath);
            return this.buildPrompt(rules, languagePrompt, diff, blameAnalysis, STRICT_FORMAT_REMINDER);
        }

        const reminder = format === 'detailed' ? DETAILED_FORMAT_REMINDER : STRICT_FORMAT_REMINDER;

        return this.buildPrompt(template, languagePrompt, diff, blameAnalysis, reminder);
    }

    static async generateRefinementPrompt(originalMessage: string, errors: string[], progress: ProgressReporter): Promise<string> {
        const format = ConfigService.get('commit.commitFormat') as CommitFormat;

        const { languagePrompt } = await this.resolveLanguagePrompt(format, progress);

        return `The following commit message failed commitlint validation:

${originalMessage}

Validation errors:
${errors.map(e => `- ${e}`).join('\n')}

Rewrite the commit message fixing all the errors above.
${languagePrompt}

${STRICT_FORMAT_REMINDER}

Please provide ONLY the corrected commit message, without any additional text or explanations.
`;
    }
}