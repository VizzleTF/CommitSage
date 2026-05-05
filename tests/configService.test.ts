import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConfigService } from '../src/utils/configService';

describe('ConfigService.hasValidProjectConfig (F034)', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-test-'));
        // Point ConfigService at our temp folder via the static helper.
        vi.spyOn(ConfigService, 'getProjectRootPath').mockReturnValue(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('returns valid:true when no project config exists', async () => {
        expect(await ConfigService.hasValidProjectConfig()).toEqual({ valid: true });
    });

    it('returns valid:true when project config is well-formed JSON object', async () => {
        const dir = path.join(tmpDir, '.commitsage');
        fs.mkdirSync(dir);
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({ commit: { autoCommit: true } }));

        const result = await ConfigService.hasValidProjectConfig();
        expect(result.valid).toBe(true);
        expect(result.configPath).toBe(configPath);
    });

    it('returns valid:false on syntactically invalid JSON', async () => {
        const dir = path.join(tmpDir, '.commitsage');
        fs.mkdirSync(dir);
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, '{ broken json');

        const result = await ConfigService.hasValidProjectConfig();
        expect(result.valid).toBe(false);
        expect(result.configPath).toBe(configPath);
        expect(result.error).toBeInstanceOf(Error);
    });

    it('returns valid:false when top-level JSON is not an object', async () => {
        const dir = path.join(tmpDir, '.commitsage');
        fs.mkdirSync(dir);
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(['not', 'an', 'object']));

        const result = await ConfigService.hasValidProjectConfig();
        expect(result.valid).toBe(false);
        expect(result.error?.message).toMatch(/not a JSON object/);
    });
});

describe('ConfigService.parseAndValidateProjectConfig type-check (L4)', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitsage-l4-'));
        vi.spyOn(ConfigService, 'getProjectRootPath').mockReturnValue(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('drops leaf values whose type does not match SETTING_DEFAULTS', async () => {
        const dir = path.join(tmpDir, '.commitsage');
        fs.mkdirSync(dir);
        const configPath = path.join(dir, 'config.json');
        // commit.autoCommit is boolean in defaults; "yes" is wrong type.
        // commit.customInstructions is string in defaults; the number 42 is wrong type.
        // commit.onlyStagedChanges (boolean) — correct, should survive.
        fs.writeFileSync(
            configPath,
            JSON.stringify({
                commit: {
                    autoCommit: 'yes',
                    customInstructions: 42,
                    onlyStagedChanges: true,
                },
            }),
        );

        // Reach into the private loader through the public initialize path.
        await (
            ConfigService as unknown as { loadProjectConfig: () => Promise<void> }
        ).loadProjectConfig();

        // Surviving boolean is reflected by .get(), wrong-typed values fall back to defaults.
        expect(ConfigService.get('commit.onlyStagedChanges')).toBe(true);
        expect(ConfigService.get('commit.autoCommit')).toBe(false); // default
        expect(ConfigService.get('commit.customInstructions')).toBe(''); // default
    });
});

describe('ConfigService.onProjectConfigChange (F052)', () => {
    it('fires registered listeners and stops firing after dispose', () => {
        let count = 0;
        const sub = ConfigService.onProjectConfigChange(() => {
            count++;
        });

        // Reach into the private handler the watcher would invoke.
        const handler = (
            ConfigService as unknown as { handleProjectConfigChange: () => void }
        ).handleProjectConfigChange.bind(ConfigService);

        handler();
        handler();
        expect(count).toBe(2);

        sub.dispose();
        handler();
        expect(count).toBe(2);
    });

    it('a throwing listener does not block subsequent listeners', () => {
        let secondCount = 0;
        const sub1 = ConfigService.onProjectConfigChange(() => {
            throw new Error('boom');
        });
        const sub2 = ConfigService.onProjectConfigChange(() => {
            secondCount++;
        });

        const handler = (
            ConfigService as unknown as { handleProjectConfigChange: () => void }
        ).handleProjectConfigChange.bind(ConfigService);
        handler();
        expect(secondCount).toBe(1);

        sub1.dispose();
        sub2.dispose();
    });
});
