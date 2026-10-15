/**
 * Opt-in prompt quality eval: sends real fixture diffs through the full
 * generation pipeline to a real model and writes the replies to a Markdown
 * report, so two prompt versions can be compared side by side. Skipped unless
 * COMMITSAGE_EVAL is set; see docs/testing.md, "Prompt quality eval".
 */
import { describe, it, vi, beforeAll } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { ConfigService, SETTING_DEFAULTS, type SettingKey } from '../src/utils/configService';
import { ApiKeyManager } from '../src/services/apiKeyManager';
import { AIService } from '../src/services/aiService';

const env = process.env;
const FIXTURES = resolve(__dirname, 'fixtures/eval');
const RUNS = Number(env.EVAL_RUNS ?? 3);
// Deterministic-ish by default; EVAL_SETTINGS overrides any key.
const settings: Record<string, unknown> = {
    'general.temperature': 0,
    apiRequestTimeout: 300,
    ...JSON.parse(env.EVAL_SETTINGS ?? '{}') as Record<string, unknown>,
};

describe.runIf(env.COMMITSAGE_EVAL)('prompt quality eval', () => {
    beforeAll(() => {
        vi.spyOn(ConfigService, 'get').mockImplementation(
            (key: SettingKey) => (key in settings ? settings[key] : SETTING_DEFAULTS[key]) as never,
        );
        vi.spyOn(ApiKeyManager, 'getKey').mockResolvedValue(env.EVAL_API_KEY ?? '');
        vi.spyOn(ApiKeyManager, 'getOptionalKey').mockResolvedValue(env.EVAL_API_KEY);
    });

    it('writes model replies for every fixture', async () => {
        const names = readdirSync(FIXTURES).filter(f => f.endsWith('.diff')).map(f => f.slice(0, -'.diff'.length));
        const progress = { report: () => undefined };
        const report = [`# ${env.EVAL_LABEL ?? 'eval'}: ${ConfigService.getProvider()} / ${ConfigService.getModel()}`];

        for (const name of names) {
            const diff = readFileSync(join(FIXTURES, `${name}.diff`), 'utf8');
            const expected = readFileSync(join(FIXTURES, `${name}.expected.txt`), 'utf8').trim();
            report.push(`\n## ${name} (${diff.length} chars)\n\nReference:\n\n\`\`\`text\n${expected}\n\`\`\``);
            for (let run = 1; run <= RUNS; run++) {
                const reply = await AIService.generateCommitMessage(process.cwd(), diff, '', progress)
                    .then(r => r.message, (e: Error) => `ERROR: ${e.message}`);
                report.push(`\nRun ${run}:\n\n\`\`\`text\n${reply}\n\`\`\``);
            }
        }

        const outDir = resolve(env.EVAL_OUT ?? 'eval-out');
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, `${env.EVAL_LABEL ?? 'eval'}.md`), report.join('\n') + '\n');
    }, 60 * 60 * 1000);
});
