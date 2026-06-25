import { describe, it, expect } from 'vitest';
import { getTemplate } from '../src/templates/index';
import type { CommitFormat } from '../src/templates/index';
import { conventionalTemplate } from '../src/templates/formats/conventional';
import { angularTemplate } from '../src/templates/formats/angular';
import { karmaTemplate } from '../src/templates/formats/karma';
import { semanticTemplate } from '../src/templates/formats/semantic';
import { emojiTemplate } from '../src/templates/formats/emoji';
import { emojiKarmaTemplate } from '../src/templates/formats/emojiKarma';
import { googleTemplate } from '../src/templates/formats/google';
import { atomTemplate } from '../src/templates/formats/atom';
import { detailedTemplate } from '../src/templates/formats/detailed';

const allTemplates = {
    conventional: conventionalTemplate,
    angular: angularTemplate,
    karma: karmaTemplate,
    semantic: semanticTemplate,
    emoji: emojiTemplate,
    emojiKarma: emojiKarmaTemplate,
    google: googleTemplate,
    atom: atomTemplate,
    detailed: detailedTemplate,
};

describe('template format data objects', () => {
    for (const [name, tpl] of Object.entries(allTemplates)) {
        it(`${name} exposes language strings`, () => {
            expect(typeof tpl).toBe('object');
            expect(typeof tpl.english).toBe('string');
            expect(tpl.english.length).toBeGreaterThan(0);
            expect(typeof tpl.russian).toBe('string');
        });
    }
});

describe('getTemplate', () => {
    it('returns the requested format/language', () => {
        expect(getTemplate('angular', 'english')).toBe(angularTemplate.english);
        expect(getTemplate('emoji', 'russian')).toBe(emojiTemplate.russian);
    });

    it('falls back to conventional for an unknown format', () => {
        const result = getTemplate('nope' as CommitFormat, 'english');
        expect(result).toBe(conventionalTemplate.english);
    });

    it('falls back to english for an unknown language', () => {
        const result = getTemplate('conventional', 'klingon' as never);
        expect(result).toBe(conventionalTemplate.english);
    });

    it('falls back to english for a custom language without warning path', () => {
        const result = getTemplate('conventional', 'custom');
        expect(result).toBe(conventionalTemplate.english);
    });
});
