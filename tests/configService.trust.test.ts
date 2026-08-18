import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

import { ConfigService } from '../src/utils/configService';

/**
 * `.commitsage/config.json` is checked into the repository and outranks every
 * VS Code settings layer, so an untrusted workspace must not be able to use it
 * to redirect the diff to another endpoint (V1) or to enable auto-commit /
 * auto-push (V2). VS Code's `restrictedConfigurations` only covers the settings
 * store, never a file the extension reads itself.
 */

function setProjectConfig(config: Record<string, unknown>): void {
    (ConfigService as unknown as { projectConfigCache: unknown }).projectConfigCache = config;
}

function setTrusted(trusted: boolean): void {
    (vscode.workspace as unknown as { isTrusted: boolean }).isTrusted = trusted;
}

beforeEach(() => {
    ConfigService.clearCache();
    setProjectConfig({});
});

afterEach(() => {
    setTrusted(true);
    ConfigService.clearCache();
    (ConfigService as unknown as { projectConfigCache: unknown }).projectConfigCache = null;
});

describe('ConfigService project-config trust gate', () => {
    it('applies trust-sensitive project values in a trusted workspace', () => {
        setTrusted(true);
        setProjectConfig({
            provider: { type: 'custom' },
            custom: { baseUrl: 'https://attacker.example/collect' },
            commit: { autoCommit: true, autoPush: true },
        });

        expect(ConfigService.get('provider.type')).toBe('custom');
        expect(ConfigService.get('custom.baseUrl')).toBe('https://attacker.example/collect');
        expect(ConfigService.get('commit.autoCommit')).toBe(true);
        expect(ConfigService.get('commit.autoPush')).toBe(true);
    });

    it('ignores endpoint and provider overrides in an untrusted workspace (V1)', () => {
        setTrusted(false);
        setProjectConfig({
            provider: { type: 'custom' },
            custom: {
                baseUrl: 'https://attacker.example/collect',
                chatCompletionsPath: '/x',
                useApiKey: true,
            },
            openai: { baseUrl: 'https://attacker.example/v1' },
            ollama: { baseUrl: 'https://attacker.example' },
        });

        expect(ConfigService.get('provider.type')).toBe('gemini');
        expect(ConfigService.get('custom.baseUrl')).toBe('http://localhost:1234/v1');
        expect(ConfigService.get('custom.chatCompletionsPath')).toBe('/chat/completions');
        expect(ConfigService.get('custom.useApiKey')).toBe(false);
        expect(ConfigService.get('openai.baseUrl')).toBe('https://api.openai.com/v1');
        expect(ConfigService.get('ollama.baseUrl')).toBe('http://localhost:11434');
    });

    it('ignores autoCommit / autoPush in an untrusted workspace (V2)', () => {
        setTrusted(false);
        setProjectConfig({ commit: { autoCommit: true, autoPush: true } });

        expect(ConfigService.get('commit.autoCommit')).toBe(false);
        expect(ConfigService.get('commit.autoPush')).toBe(false);
    });

    it('ignores commitlint engine / rules path in an untrusted workspace (V3)', () => {
        setTrusted(false);
        setProjectConfig({
            commit: {
                commitlint: { enabled: true, engine: 'project', rulesPath: 'evil.js' },
            },
        });

        expect(ConfigService.get('commit.commitlint.enabled')).toBe(false);
        expect(ConfigService.get('commit.commitlint.engine')).toBe('builtin');
        expect(ConfigService.get('commit.commitlint.rulesPath')).toBe('');
    });

    it('still applies harmless project values in an untrusted workspace', () => {
        setTrusted(false);
        setProjectConfig({
            commit: { commitFormat: 'karma', commitLanguage: 'russian' },
            general: { temperature: 0.2 },
        });

        expect(ConfigService.get('commit.commitFormat')).toBe('karma');
        expect(ConfigService.get('commit.commitLanguage')).toBe('russian');
        expect(ConfigService.get('general.temperature')).toBe(0.2);
    });

    it('does not report a gated key as project-overridden', () => {
        setProjectConfig({ commit: { autoCommit: true } });

        setTrusted(true);
        expect(ConfigService.isProjectOverridden('commit.autoCommit')).toBe(true);

        setTrusted(false);
        expect(ConfigService.isProjectOverridden('commit.autoCommit')).toBe(false);
    });
});
