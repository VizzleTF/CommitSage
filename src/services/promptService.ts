import { CommitFormat, Language, getTemplate } from '../templates';
import { ConfigService } from '../utils/configService';

export class PromptService {
    static generatePrompt(diff: string, blameAnalysis: string): string {
        const format = ConfigService.getCommitFormat() as CommitFormat;
        const language = ConfigService.getCommitLanguage() === 'russian' ? 'ru' : 'en';
        const template = getTemplate(format, language);

        return `${template}
      
Git diff to analyze:
${diff}
      
Git blame analysis:
${blameAnalysis}
      
Please provide ONLY the commit message, without any additional text or explanations.`;
    }
}