import { CommitFormat, getTemplate } from '../templates';
import { ConfigService } from '../utils/configService';
import type { CommitLanguage } from '../utils/configService';

export class PromptService {
    static generatePrompt(diff: string, blameAnalysis: string): string {
        const format = ConfigService.getCommitFormat() as CommitFormat;
        const commitLanguage = ConfigService.getCommitLanguage() as CommitLanguage;
        const languagePrompt = this.getLanguagePrompt(commitLanguage);
        const template = getTemplate(format, commitLanguage);

        return `${template}

${languagePrompt}

Git diff to analyze:
${diff}

Git blame analysis:
${blameAnalysis}

Please provide ONLY the commit message, without any additional text or explanations.`;
    }

    static getLanguagePrompt(language: CommitLanguage): string {
        switch (language.toLowerCase()) {
            case 'russian':
                return 'Пожалуйста, напиши сообщение коммита на русском языке.';
            case 'chinese':
                return '请用中文写提交信息。';
            case 'japanese':
                return 'コミットメッセージを日本語で書いてください。';
            default:
                return 'Please write the commit message in English.';
        }
    }
}