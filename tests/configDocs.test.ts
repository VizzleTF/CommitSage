import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('settings documentation', () => {
    it('documents every contributed setting', () => {
        const configuration = JSON.parse(read('package.json')).contributes.configuration;
        const sections = Array.isArray(configuration) ? configuration : [configuration];
        const keys = sections.flatMap((s: { properties: object }) => Object.keys(s.properties));
        const docs = read('docs/configuration.md') + read('docs/providers.md');

        expect(keys.filter((k) => !docs.includes(k))).toEqual([]);
    });
});
