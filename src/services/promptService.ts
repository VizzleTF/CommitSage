import { CommitFormat, getTemplate } from '../templates';
import { ConfigService } from '../utils/configService';
import type { CommitLanguage } from '../utils/constants';

const LANGUAGE_PROMPTS: Record<CommitLanguage, string> = {
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
    static generatePrompt(diff: string, blameAnalysis: string): string {
        const useCustomInstructions = ConfigService.useCustomInstructions();
        const customInstructions = ConfigService.getCustomInstructions();

        if (useCustomInstructions && customInstructions.trim()) {
            return `${customInstructions}

Git diff to analyze:
${diff}

Git blame analysis:
${blameAnalysis}

Please provide ONLY the commit message, without any additional text or explanations.`;
        }

        const format = ConfigService.getCommitFormat() as CommitFormat;
        const commitLanguage = ConfigService.getCommitLanguage() as CommitLanguage;
        const languagePrompt = LANGUAGE_PROMPTS[commitLanguage] ?? LANGUAGE_PROMPTS.english;
        const template = getTemplate(format, commitLanguage);

        return `${template}

${languagePrompt}

Git diff to analyze:
${diff}

Git blame analysis:
${blameAnalysis}

Please provide ONLY the commit message, without any additional text or explanations.`;
    }
}