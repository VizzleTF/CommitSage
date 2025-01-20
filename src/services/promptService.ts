import { CommitFormat, getTemplate } from '../templates';
import { ConfigService } from '../utils/configService';

export class PromptService {
    static generatePrompt(diff: string, blameAnalysis: string): string {
        const languageMap = {
            russian: 'ru',
            english: 'en',
            chinese: 'cn'
          } as const;
        const format = ConfigService.getCommitFormat() as CommitFormat;
        type LanguageKey = keyof typeof languageMap; 
        const commitLanguage = ConfigService.getCommitLanguage() as LanguageKey;
        const language = languageMap[commitLanguage] || 'en'; // 默认值为 'en'，如果 commitLanguage 不是预期值之一
        const template = getTemplate(format, language);

        return `${template}
      
Git diff to analyze:
${diff}
      
Git blame analysis:
${blameAnalysis}
      
Please provide ONLY the commit message, without any additional text or explanations.`;
    }
}