import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { getTemplate, CommitFormat } from '../templates';
import { ProgressReporter } from '../models/types';
import { AIServiceFactory, AIServiceType } from './aiServiceFactory';
import { toError } from '../utils/errorUtils';

type TranslationsFile = Record<string, Partial<Record<CommitFormat, string>>>;

const TRANSLATIONS_FILE = 'translations.json';

export class CustomLanguageService {
    private static getTranslationsPath(): string | null {
        const rootPath = ConfigService.getProjectRootPath();
        if (!rootPath) {
            return null;
        }
        return path.join(rootPath, '.commitsage', TRANSLATIONS_FILE);
    }

    private static async ensureCommitsageDirectory(): Promise<void> {
        const rootPath = ConfigService.getProjectRootPath();
        if (!rootPath) {
            return;
        }

        const commitsagePath = path.join(rootPath, '.commitsage');

        try {
            await fs.promises.mkdir(commitsagePath, { recursive: true });
        } catch (error) {
            Logger.error('Failed to create .commitsage directory:', toError(error));
        }
    }

    private static async readTranslations(): Promise<TranslationsFile> {
        const filePath = this.getTranslationsPath();
        if (!filePath) {
            return {};
        }

        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return JSON.parse(content) as TranslationsFile;
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            // Missing file is the common case — not an error to log.
            if (err && err.code === 'ENOENT') {
                return {};
            }
            Logger.error('Failed to read translations.json:', toError(error));
            return {};
        }
    }

    static async getCachedTemplate(format: CommitFormat, customLanguageName: string): Promise<string | null> {
        const translations = await this.readTranslations();
        const template = translations[customLanguageName]?.[format];
        if (template) {
            Logger.log(`Using cached custom language template for ${customLanguageName}/${format}`);
            return template;
        }
        return null;
    }

    private static async saveCachedTemplate(
        format: CommitFormat,
        customLanguageName: string,
        template: string
    ): Promise<void> {
        const filePath = this.getTranslationsPath();
        if (!filePath) {
            return;
        }

        try {
            await this.ensureCommitsageDirectory();

            const translations = await this.readTranslations();
            if (!translations[customLanguageName]) {
                translations[customLanguageName] = {};
            }
            translations[customLanguageName][format] = template;

            await fs.promises.writeFile(
                filePath,
                JSON.stringify(translations, null, 2),
                'utf8'
            );
            Logger.log(`Saved translation for ${customLanguageName}/${format} to ${filePath}`);
        } catch (error) {
            Logger.error('Failed to save translation:', toError(error));
        }
    }

    static async generateAndCacheTemplate(
        format: CommitFormat,
        customLanguageName: string,
        progress: ProgressReporter
    ): Promise<string> {
        progress.report({ message: `Translating commit format to ${customLanguageName}...`, increment: 20 });

        const englishTemplate = getTemplate(format, 'english');
        const russianTemplate = getTemplate(format, 'russian');
        const translationPrompt = `Translate the following commit format instructions into ${customLanguageName}.

Below is an example showing the English original and its Russian translation.
Use this example to understand the required output format, level of completeness, and what must not be translated.

--- ENGLISH ---
${englishTemplate}

--- RUSSIAN TRANSLATION (example of correct output) ---
${russianTemplate}

--- YOUR TASK ---
Translate the ENGLISH text above into ${customLanguageName}.
Rules:
- Output ONLY the translated text. No intro sentence, no commentary, no code fences.
- Keep exactly the same structure, line count, and blank lines as the English original.
- Do NOT translate: commit type names (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert), emoji codes like :sparkles:, format patterns like \`type(scope): description\`, and placeholder tags like <type>.
- Translate everything else.

--- ${customLanguageName.toUpperCase()} TRANSLATION ---`;

        const provider = ConfigService.getProvider() as AIServiceType;
        const result = await AIServiceFactory.generateCommitMessage(provider, translationPrompt, progress, undefined, { maxTokens: 4096 });
        const translatedTemplate = result.message.trim();

        await this.saveCachedTemplate(format, customLanguageName, translatedTemplate);
        return translatedTemplate;
    }

    static async getTemplate(
        format: CommitFormat,
        customLanguageName: string,
        progress: ProgressReporter
    ): Promise<string> {
        if (!customLanguageName.trim()) {
            Logger.warn('customLanguageName is empty, falling back to English template');
            return getTemplate(format, 'english');
        }

        const cached = await this.getCachedTemplate(format, customLanguageName);
        if (cached) {
            return cached;
        }

        return this.generateAndCacheTemplate(format, customLanguageName, progress);
    }
}
