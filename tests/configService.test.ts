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

    it('returns valid:true when no project config exists', () => {
        expect(ConfigService.hasValidProjectConfig()).toEqual({ valid: true });
    });

    it('returns valid:true when project config is well-formed JSON object', () => {
        const dir = path.join(tmpDir, '.commitsage');
        fs.mkdirSync(dir);
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify({ commit: { autoCommit: true } }));

        const result = ConfigService.hasValidProjectConfig();
        expect(result.valid).toBe(true);
        expect(result.configPath).toBe(configPath);
    });

    it('returns valid:false on syntactically invalid JSON', () => {
        const dir = path.join(tmpDir, '.commitsage');
        fs.mkdirSync(dir);
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, '{ broken json');

        const result = ConfigService.hasValidProjectConfig();
        expect(result.valid).toBe(false);
        expect(result.configPath).toBe(configPath);
        expect(result.error).toBeInstanceOf(Error);
    });

    it('returns valid:false when top-level JSON is not an object', () => {
        const dir = path.join(tmpDir, '.commitsage');
        fs.mkdirSync(dir);
        const configPath = path.join(dir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(['not', 'an', 'object']));

        const result = ConfigService.hasValidProjectConfig();
        expect(result.valid).toBe(false);
        expect(result.error?.message).toMatch(/not a JSON object/);
    });
});
