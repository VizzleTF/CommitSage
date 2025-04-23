import { conventionalTemplate } from './formats/conventional';
import { angularTemplate } from './formats/angular';
import { karmaTemplate } from './formats/karma';
import { semanticTemplate } from './formats/semantic';
import { emojiTemplate } from './formats/emoji';
import { emojiKarmaTemplate } from './formats/emojiKarma';
import type { CommitLanguage } from '../utils/configService';

export interface CommitTemplate {
    english: string;
    russian: string;
    chinese: string;
    japanese: string;
    spanish: string;
}

export type CommitFormat = 'conventional' | 'angular' | 'karma' | 'semantic' | 'emoji' | 'emojiKarma';

const SUPPORTED_LANGUAGES = ['english', 'russian', 'chinese', 'japanese', 'spanish'] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

const templates: Record<CommitFormat, CommitTemplate> = {
    conventional: conventionalTemplate,
    angular: angularTemplate,
    karma: karmaTemplate,
    semantic: semanticTemplate,
    emoji: emojiTemplate,
    emojiKarma: emojiKarmaTemplate
} as const;

const isValidFormat = (format: string): format is CommitFormat =>
    Object.keys(templates).includes(format);

const isValidLanguage = (language: string): language is SupportedLanguage =>
    SUPPORTED_LANGUAGES.includes(language as SupportedLanguage);

export function getTemplate(format: CommitFormat, language: CommitLanguage): string {
    if (!isValidFormat(format)) {
        console.warn(`Invalid format "${format}", falling back to conventional`);
        format = 'conventional';
    }

    const template = templates[format];

    if (!isValidLanguage(language)) {
        console.warn(`Invalid language "${language}", falling back to english`);
        return template.english;
    }

    return template[language];
}