import { conventionalTemplate } from './formats/conventional';
import { angularTemplate } from './formats/angular';
import { karmaTemplate } from './formats/karma';
import { semanticTemplate } from './formats/semantic';
import { emojiTemplate } from './formats/emoji';
import { emojiKarmaTemplate } from './formats/emojiKarma';
import { googleTemplate } from './formats/google';
import { atomTemplate } from './formats/atom';
import type { CommitLanguage } from '../utils/configService';
import { Logger } from '../utils/logger';

export interface CommitTemplate {
    english: string;
    russian: string;
    chinese: string;
    japanese: string;
    spanish: string;
}

export type CommitFormat = 'conventional' | 'angular' | 'karma' | 'semantic' | 'emoji' | 'emojiKarma' | 'google' | 'atom';

const SUPPORTED_LANGUAGES = ['english', 'russian', 'chinese', 'japanese', 'spanish'] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

const templates: Record<CommitFormat, CommitTemplate> = {
    conventional: conventionalTemplate,
    angular: angularTemplate,
    karma: karmaTemplate,
    semantic: semanticTemplate,
    emoji: emojiTemplate,
    emojiKarma: emojiKarmaTemplate,
    google: googleTemplate,
    atom: atomTemplate
} as const;

const isValidFormat = (format: string): format is CommitFormat =>
    Object.keys(templates).includes(format);

const isValidLanguage = (language: string): language is SupportedLanguage =>
    SUPPORTED_LANGUAGES.includes(language as SupportedLanguage);

export function getTemplate(format: CommitFormat, language: CommitLanguage): string {
    if (!isValidFormat(format)) {
        Logger.warn(`Invalid format "${format}", falling back to conventional`);
        format = 'conventional';
    }

    const template = templates[format];

    if (!isValidLanguage(language)) {
        Logger.warn(`Invalid language "${language}", falling back to english`);
        return template.english;
    }

    return template[language];
}