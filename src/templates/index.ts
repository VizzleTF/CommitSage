import { conventionalTemplate } from './formats/conventional';
import { angularTemplate } from './formats/angular';
import { karmaTemplate } from './formats/karma';
import { semanticTemplate } from './formats/semantic';
import { emojiTemplate } from './formats/emoji';
import { emojiKarmaTemplate } from './formats/emojiKarma';
import { googleTemplate } from './formats/google';
import { atomTemplate } from './formats/atom';
import { detailedTemplate } from './formats/detailed';
import { previousTemplate } from './formats/previous';
import { SUPPORTED_LANGUAGES } from '../utils/constants';
import type { CommitLanguage } from '../utils/constants';
import { Logger } from '../utils/logger';

type CommitTemplate = Record<Exclude<CommitLanguage, 'custom'>, string>;

export type CommitFormat = 'conventional' | 'angular' | 'karma' | 'semantic' | 'emoji' | 'emojiKarma' | 'google' | 'atom' | 'detailed' | 'previous';

/**
 * Defines where a ticket ID (e.g. PROJ-123) is placed in the commit header
 * for each format. 'scope' → type(TICKET): desc; 'prefix' → type: TICKET desc.
 */
const TICKET_PLACEMENT: Record<CommitFormat, 'scope' | 'prefix'> = {
    conventional: 'scope',
    angular:      'scope',
    karma:        'scope',
    google:       'scope',
    emoji:        'scope',
    emojiKarma:   'scope',
    semantic:     'prefix',
    atom:         'prefix',
    detailed:     'prefix',
};

export function getTicketPlacement(format: string): 'scope' | 'prefix' {
    return TICKET_PLACEMENT[format as CommitFormat] ?? 'scope';
}

const templates: Record<CommitFormat, CommitTemplate> = {
    conventional: conventionalTemplate,
    angular: angularTemplate,
    karma: karmaTemplate,
    semantic: semanticTemplate,
    emoji: emojiTemplate,
    emojiKarma: emojiKarmaTemplate,
    google: googleTemplate,
    atom: atomTemplate,
    detailed: detailedTemplate,
    previous: previousTemplate
} as const;

const isValidFormat = (format: string): format is CommitFormat =>
    Object.keys(templates).includes(format);

type KnownLanguage = Exclude<CommitLanguage, 'custom'>;

const isValidLanguage = (language: string): language is KnownLanguage =>
    SUPPORTED_LANGUAGES.includes(language as CommitLanguage) && language !== 'custom';

export function getTemplate(format: CommitFormat, language: CommitLanguage): string {
    if (!isValidFormat(format)) {
        Logger.warn(`Invalid format "${format}", falling back to conventional`);
        format = 'conventional';
    }

    const template = templates[format];

    if (!isValidLanguage(language)) {
        if (language !== 'custom') {
            Logger.warn(`Invalid language "${language}", falling back to english`);
        }
        return template.english;
    }

    return template[language];
}