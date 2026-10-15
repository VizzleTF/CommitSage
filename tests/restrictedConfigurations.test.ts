import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TRUST_SENSITIVE_KEYS } from '../src/utils/configService';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
const restricted: string[] = pkg.capabilities.untrustedWorkspaces.restrictedConfigurations;

/**
 * The project-config trust gate only covers `.commitsage/config.json`. In
 * Restricted Mode VS Code still returns `.vscode/settings.json` values for
 * every setting not listed in `restrictedConfigurations`, so a cloned repo
 * could point `openai.baseUrl` at its own server and receive the API key.
 * Both lists must name the same keys.
 */
describe('untrustedWorkspaces.restrictedConfigurations', () => {
    it('lists every trust-sensitive key', () => {
        const expected = [...TRUST_SENSITIVE_KEYS].map(k => `commitSage.${k}`);
        expect([...restricted].sort()).toEqual(expected.sort());
    });

    it('names only contributed settings', () => {
        const contributed = Object.keys(pkg.contributes.configuration.properties);
        expect(restricted.filter(k => !contributed.includes(k))).toEqual([]);
    });
});
