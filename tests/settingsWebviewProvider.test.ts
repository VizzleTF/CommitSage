import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { SettingsWebviewProvider } from '../src/views/settingsWebviewProvider';
import { ConfigService, SETTING_DEFAULTS } from '../src/utils/configService';
import { ApiKeyManager } from '../src/services/apiKeyManager';
import { CommitLintCliService } from '../src/services/commitLintCliService';
import { providerDef } from '../src/services/providerRegistry';
import type { IncomingMessage, ViewState } from '../src/views/webview/protocol';

type ConfigEvent = { affectsConfiguration(section: string): boolean };

function setProjectConfig(config: Record<string, unknown> | null): void {
    (ConfigService as unknown as { projectConfigCache: unknown }).projectConfigCache = config;
    ConfigService.clearCache();
}

/** Resolve the view against fakes; returns the posted states and the two inbound channels. */
function mount() {
    let onMessage!: (msg: IncomingMessage) => void;
    let onConfig!: (e: ConfigEvent) => void;
    let onDispose!: () => void;
    let onProjectConfig!: () => void;
    vi.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockImplementation(
        ((listener: (e: ConfigEvent) => void) => {
            onConfig = listener;
            return { dispose: () => undefined };
        }) as never,
    );
    vi.spyOn(ConfigService, 'onProjectConfigChange').mockImplementation(listener => {
        onProjectConfig = listener;
        return { dispose: () => undefined };
    });
    const states: ViewState[] = [];
    const disposable = { dispose: () => undefined };
    const view = {
        visible: true,
        webview: {
            options: {},
            html: '',
            cspSource: 'csp',
            asWebviewUri: (u: unknown) => u,
            onDidReceiveMessage: (listener: (msg: IncomingMessage) => void) => {
                onMessage = listener;
                return disposable;
            },
            postMessage: async (m: { state: ViewState }) => {
                states.push(m.state);
                return true;
            },
        },
        onDidDispose: (listener: () => void) => {
            onDispose = listener;
            return disposable;
        },
        onDidChangeVisibility: () => disposable,
    };
    const context = {
        extensionUri: vscode.Uri.file('/ext'),
        subscriptions: [],
        secrets: { onDidChange: () => disposable },
    };
    const provider = new SettingsWebviewProvider(context as never);
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    return {
        models: (provider as unknown as { models: Record<string, { list: string[]; loading: boolean; error: string | null }> }).models,
        html: view.webview.html,
        states,
        dispose: () => onDispose(),
        projectConfigChanged: () => onProjectConfig(),
        send: (msg: IncomingMessage) => onMessage(msg),
        configChanged: (...keys: string[]) => onConfig({ affectsConfiguration: k => k === 'commitSage' || keys.includes(k) }),
    };
}

/** Trigger one push (a config change) and return the state it carried. */
async function pushedState(m: ReturnType<typeof mount>): Promise<ViewState> {
    const before = m.states.length;
    m.configChanged();
    await vi.waitFor(() => expect(m.states.length).toBeGreaterThan(before));
    return m.states[m.states.length - 1];
}

beforeEach(() => {
    setProjectConfig({});
    vi.spyOn(ApiKeyManager, 'getOptionalKey').mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    setProjectConfig(null);
});

describe('SettingsWebviewProvider state', () => {
    it('sends every panel setting under its dotted key, without telemetry.enabled', async () => {
        const state = await pushedState(mount());
        const expected = Object.keys(SETTING_DEFAULTS).filter(k => k !== 'telemetry.enabled').sort();
        expect(Object.keys(state.settings).sort()).toEqual(expected);
        expect(state.settings['general.temperature']).toBe(SETTING_DEFAULTS['general.temperature']);
        expect(state.projectOverrides).toEqual([]);
    });

    it('lists keys pinned by the project config and sends their pinned values', async () => {
        setProjectConfig({ commit: { refs: { enabled: true } }, general: { temperature: 0.1 } });
        const state = await pushedState(mount());
        expect(state.projectOverrides.sort()).toEqual(['commit.refs.enabled', 'general.temperature']);
        expect(state.settings['general.temperature']).toBe(0.1);
        expect(state.settings['commit.refs.enabled']).toBe(true);
    });

    it('pushes new values and pins when .commitsage/config.json changes', async () => {
        const m = mount();
        setProjectConfig({ general: { temperature: 0.1 } });
        m.projectConfigChanged();
        await vi.waitFor(() => expect(m.states.length).toBeGreaterThan(0));
        const state = m.states[m.states.length - 1];
        expect(state.projectOverrides).toEqual(['general.temperature']);
        expect(state.settings['general.temperature']).toBe(0.1);
    });

    it('does not throw or leave a refresh loading when the view is disposed mid-push', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        vi.spyOn(ApiKeyManager, 'getOptionalKey').mockImplementation(async () => {
            await gate;
            return undefined;
        });
        vi.spyOn(providerDef('gemini'), 'fetchModels').mockResolvedValue(['g']);
        const m = mount();
        const rejections: unknown[] = [];
        const onRejection = (e: unknown) => rejections.push(e);
        process.on('unhandledRejection', onRejection);
        try {
            m.configChanged('commitSage.provider.type');
            m.dispose();
            release();
            await vi.waitFor(() => expect(m.models.gemini.list).toEqual(['g']));
            await new Promise(r => setTimeout(r, 0));
            expect(m.models.gemini.loading).toBe(false);
            expect(rejections).toEqual([]);
        } finally {
            process.off('unhandledRejection', onRejection);
        }
    });

    it('falls back to gemini for an invalid provider.type, like generation does', async () => {
        setProjectConfig({ provider: { type: 'claude' } });
        const state = await pushedState(mount());
        expect(state.provider).toBe('gemini');
    });

    it('skips the commitlint CLI lookup while commitlint is off', async () => {
        const detect = vi.spyOn(CommitLintCliService, 'detect');
        vi.spyOn(ConfigService, 'getProjectRootPath').mockReturnValue('/repo');
        const state = await pushedState(mount());
        expect(state.commitlintCliAvailable).toBe(false);
        expect(detect).not.toHaveBeenCalled();
    });

    it('embeds init data that parses back even with `</script>` and `<!--` in it', () => {
        vi.spyOn(vscode.l10n, 't').mockImplementation((s: string) => (s === 'Provider' ? '</script><!--x' : s));
        const { html } = mount();
        const json = /<script id="init-data" type="application\/json">(.*?)<\/script>/s.exec(html)![1];
        expect(json).not.toContain('<');
        expect(JSON.parse(json).l10n.provider).toBe('</script><!--x');
    });
});

describe('SettingsWebviewProvider setSetting', () => {
    it('writes a panel setting through ConfigService.set', async () => {
        const set = vi.spyOn(ConfigService, 'set').mockResolvedValue();
        mount().send({ type: 'setSetting', key: 'general.temperature', value: 0.2 });
        await vi.waitFor(() => expect(set).toHaveBeenCalledWith('general.temperature', 0.2));
    });

    it.each([
        ['an unknown key', 'git.path', '/tmp/evil'],
        ['a prototype key', 'constructor', 'x'],
        ['the telemetry toggle', 'telemetry.enabled', true],
        ['a value of the wrong type', 'general.temperature', '0.2'],
    ])('ignores %s', async (_label, key, value) => {
        const set = vi.spyOn(ConfigService, 'set').mockResolvedValue();
        const m = mount();
        m.send({ type: 'setSetting', key, value } as never);
        // Let the async handler run.
        await new Promise(r => setTimeout(r, 0));
        expect(set).not.toHaveBeenCalled();
    });
});

describe('SettingsWebviewProvider model list refresh', () => {
    it('refetches the list when the free-only filter changes', async () => {
        setProjectConfig({ provider: { type: 'openrouter' } });
        const fetchModels = vi.spyOn(providerDef('openrouter'), 'fetchModels').mockResolvedValue(['a:free']);
        const m = mount();
        m.configChanged('commitSage.openrouter.preferFreeModels');
        await vi.waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(1));
        // Forced: a second change refetches although the list is loaded.
        m.configChanged('commitSage.openrouter.preferFreeModels');
        await vi.waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(2));
    });

    it('keeps the newest list when an older forced refresh finishes last', async () => {
        setProjectConfig({ provider: { type: 'openrouter' } });
        let resolveOld!: (v: string[]) => void;
        const fetchModels = vi.spyOn(providerDef('openrouter'), 'fetchModels')
            .mockImplementationOnce(() => new Promise(r => { resolveOld = r; }))
            .mockResolvedValueOnce(['new:free']);
        const m = mount();
        m.configChanged('commitSage.openrouter.preferFreeModels');
        await vi.waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(1));
        m.configChanged('commitSage.openrouter.preferFreeModels');
        await vi.waitFor(() => expect(m.models.openrouter.list).toEqual(['new:free']));
        expect(m.models.openrouter.loading).toBe(false);
        resolveOld(['old']);
        await new Promise(r => setTimeout(r, 0));
        expect(m.models.openrouter.list).toEqual(['new:free']);
        expect(m.models.openrouter.loading).toBe(false);
    });

    it('does not fetch on an unrelated setting change', async () => {
        const fetchModels = vi.spyOn(providerDef('gemini'), 'fetchModels').mockResolvedValue([]);
        const m = mount();
        await pushedState(m);
        m.configChanged('commitSage.general.temperature');
        await new Promise(r => setTimeout(r, 0));
        expect(fetchModels).not.toHaveBeenCalled();
    });
});
