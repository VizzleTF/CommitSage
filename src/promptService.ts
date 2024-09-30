import { ConfigService } from './configService';
import {
    englishShortInstructions,
    englishLongInstructions,
    russianShortInstructions,
    russianLongInstructions,
    customInstructions
} from './commitInstructions';

export class PromptService {
    static generatePrompt(diff: string, blameAnalysis: string, language: string, messageLength: string): string {
        const instructions = this.getInstructions(language, messageLength);
        return `${instructions}
      
      Git diff to analyze:
      ${diff}
      
      Git blame analysis:
      ${blameAnalysis}
      
      Please provide ONLY the commit message, without any additional text or explanations.`;
    }

    private static getInstructions(language: string, messageLength: string): string {
        type InstructionKey = 'english-short' | 'english-long' | 'russian-short' | 'russian-long' | 'custom';
        const key = `${language}-${messageLength}` as InstructionKey;

        const instructionsMap: Record<InstructionKey, string> = {
            'english-short': englishShortInstructions,
            'english-long': englishLongInstructions,
            'russian-short': russianShortInstructions,
            'russian-long': russianLongInstructions,
            'custom': customInstructions.replace('{customInstructions}', ConfigService.getCustomInstructions())
        };

        return instructionsMap[key] ?? englishShortInstructions;
    }
}