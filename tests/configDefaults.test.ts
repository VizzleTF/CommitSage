import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJsonProperty {
    type?: string;
    default?: unknown;
    enum?: unknown[];
}

const pkgPath = path.resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    contributes: { configuration: { properties: Record<string, PackageJsonProperty> } };
};

describe('Settings schema (F036 + general)', () => {
    it('declares both apiRequestTimeout and gitTimeout as separate settings', () => {
        const props = pkg.contributes.configuration.properties;
        expect(props['commitSage.apiRequestTimeout']).toBeDefined();
        expect(props['commitSage.gitTimeout']).toBeDefined();
        expect(props['commitSage.apiRequestTimeout'].default).toBe(30);
        expect(props['commitSage.gitTimeout'].default).toBe(120);
    });

    it('every key in SETTING_DEFAULTS matches the package.json default exactly (F048)', async () => {
        // Walks every key in SETTING_DEFAULTS and asserts the package.json
        // default equals it. This catches drift like the codestral.model
        // mismatch ('codestral-2405' vs 'codestral-latest') that the old
        // 9-key spot-check missed. We compare SETTING_DEFAULTS directly
        // rather than going through ConfigService.get so the test is not
        // affected by future changes to the vscode mock's inspect() shim.
        const { SETTING_DEFAULTS } = await import('../src/utils/configService');
        const pkgProps = pkg.contributes.configuration.properties;
        for (const [leaf, expected] of Object.entries(SETTING_DEFAULTS)) {
            const fullKey = `commitSage.${leaf}`;
            expect(pkgProps[fullKey], `package.json missing ${fullKey}`).toBeDefined();
            expect(pkgProps[fullKey].default, `package.json default for ${fullKey} drifts from SETTING_DEFAULTS`).toBe(expected);
        }
    });

    it('every provider has a <provider>.model default, which getModelFor reads', async () => {
        const { SETTING_DEFAULTS } = await import('../src/utils/configService');
        const { PROVIDERS } = await import('../src/services/providerCatalog');
        for (const p of PROVIDERS) {
            expect(SETTING_DEFAULTS, `SETTING_DEFAULTS missing ${p}.model`).toHaveProperty([`${p}.model`]);
        }
    });

    it('ConfigService.knownConfigurationKeys matches the package.json schema (F053)', async () => {
        const { ConfigService } = await import('../src/utils/configService');
        const pkgKeys = Object.keys(pkg.contributes.configuration.properties);

        // Every key the telemetry attribution code might emit must exist in
        // package.json. The reverse isn't required — package.json may declare
        // settings without defaults in SETTING_DEFAULTS — but in practice the
        // two should be in sync for this codebase.
        for (const key of ConfigService.knownConfigurationKeys) {
            expect(pkgKeys, `package.json missing ${key}`).toContain(key);
        }
    });

    it('the shared format, language and thinking-level lists match the package.json enums', async () => {
        const { COMMIT_FORMATS, SUPPORTED_LANGUAGES, THINKING_LEVELS } = await import('../src/utils/constants');
        const props = pkg.contributes.configuration.properties;
        expect(props['commitSage.commit.commitFormat'].enum).toEqual([...COMMIT_FORMATS]);
        expect(props['commitSage.commit.commitLanguage'].enum).toEqual([...SUPPORTED_LANGUAGES]);
        expect(props['commitSage.gemini.thinkingLevel'].enum).toEqual([...THINKING_LEVELS]);
    });
});
