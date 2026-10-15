// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildWebviewL10n } from '../src/views/webviewL10n';
import { PROVIDERS } from '../src/services/providerRegistry';
import { SETTING_DEFAULTS } from '../src/utils/configService';
import type { Provider, ViewState, WebviewSettingKey, WebviewSettings } from '../src/views/webview/protocol';

// init.ts and vscodeApi.ts read the page at module load: set both up first.
const initEl = document.createElement('script');
initEl.id = 'init-data';
initEl.textContent = JSON.stringify({
    providers: PROVIDERS, noRefreshProviders: ['custom'], apiKeyUrls: {},
    l10n: buildWebviewL10n(),
});
document.body.appendChild(initEl);
const postMessage = vi.fn();
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage, getState: () => undefined, setState: () => undefined,
});

const sections = await import('../src/views/webview/sections');

const KEYS = (Object.keys(SETTING_DEFAULTS) as Array<keyof typeof SETTING_DEFAULTS>)
    .filter((k): k is WebviewSettingKey => k !== 'telemetry.enabled' && k !== 'general.excludeFiles');

function makeState(
    provider: Provider,
    settings: Partial<WebviewSettings>,
    projectOverrides: WebviewSettingKey[] = [],
): ViewState {
    return {
        trusted: true,
        projectOverrides,
        provider,
        settings: { ...Object.fromEntries(KEYS.map(k => [k, SETTING_DEFAULTS[k]])), ...settings } as WebviewSettings,
        models: Object.fromEntries(PROVIDERS.map(p => [p, { list: [], loading: false, error: null }])) as ViewState['models'],
        hasApiKey: Object.fromEntries(PROVIDERS.map(p => [p, false])) as ViewState['hasApiKey'],
        refsBranch: 'main',
        refsBranchRef: '',
        commitlintCliAvailable: true,
    };
}

function render(state: ViewState): HTMLElement {
    const root = document.createElement('div');
    root.append(
        sections.renderProviderPick(state),
        sections.renderModelAuthSection(state),
        sections.renderCommitSection(state),
        sections.renderRefsSection(state),
        sections.renderAutomationSection(state),
        sections.renderCommitlintSection(state),
        sections.renderAdvancedSection(state),
    );
    document.body.appendChild(root);
    return root;
}

/** Every control bound to a setting; `refs-value` is a draft saved by buttons. */
function settingControls(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('input, textarea, button.select-trigger')]
        .filter(c => c.id !== 'refs-value');
}

// Together these variants reveal every conditional control.
const VARIANTS: Array<[Provider, Partial<WebviewSettings>]> = [
    ['gemini', { 'commit.commitFormat': 'custom', 'commit.commitLanguage': 'custom' }],
    ['openai', {
        'commit.useRecentCommitsAsContext': true,
        'commit.refs.enabled': true,
        'commit.refs.source': 'branch',
        'commit.commitlint.enabled': true,
        'commit.autoCommit': true,
    }],
    ['ollama', { 'ollama.useAuthToken': true }],
    ['custom', { 'custom.useApiKey': true }],
    ['openrouter', {}],
];

beforeEach(() => {
    [...document.body.children].forEach(c => { if (c.id !== 'init-data') { c.remove(); } });
    postMessage.mockClear();
});

describe('settings sections: project-config pin', () => {
    it.each(VARIANTS)('%s: every setting control is disabled and noted when its key is pinned', (provider, settings) => {
        const root = render(makeState(provider, settings, KEYS));
        const controls = settingControls(root);
        expect(controls.length).toBeGreaterThan(5);
        for (const c of controls) {
            expect((c as HTMLInputElement).disabled, c.id).toBe(true);
        }
        expect(root.querySelectorAll('.hint.pinned')).toHaveLength(controls.length);
    });

    it.each(VARIANTS)('%s: no control is disabled when nothing is pinned', (provider, settings) => {
        // Auto-push needs auto-commit, and format `custom` disables commitlint:
        // both by design, not pins.
        const root = render(makeState(provider, { 'commit.autoCommit': true, ...settings }));
        const enabled = settingControls(root).filter(c => c.id !== 'commitlint-enabled');
        for (const c of enabled) {
            expect((c as HTMLInputElement).disabled, c.id).toBe(false);
        }
        expect(root.querySelector('.hint.pinned')).toBeNull();
    });

    it('pins only the listed key', () => {
        const root = render(makeState('openai', {}, ['general.temperature']));
        expect((root.querySelector('#temperature') as HTMLInputElement).disabled).toBe(true);
        expect((root.querySelector('#max-output-tokens') as HTMLInputElement).disabled).toBe(false);
        expect(root.querySelectorAll('.hint.pinned')).toHaveLength(1);
    });
});

describe('settings sections: flat setting keys', () => {
    it('reads the model of the current provider from `<provider>.model`', () => {
        const root = render(makeState('openai', { 'openai.model': 'gpt-4o' }));
        expect((root.querySelector('#model') as HTMLInputElement).value).toBe('gpt-4o');
    });

    it('writes a changed number under its dotted key', () => {
        const root = render(makeState('gemini', {}));
        const input = root.querySelector('#temperature') as HTMLInputElement;
        input.value = '0.3';
        input.dispatchEvent(new Event('change'));
        expect(postMessage).toHaveBeenCalledWith({ type: 'setSetting', key: 'general.temperature', value: 0.3 });
    });

    it('picking the custom format also turns on custom instructions', () => {
        Element.prototype.scrollIntoView = vi.fn();
        const root = render(makeState('gemini', {}));
        const custom = root.querySelector('#format li[data-value="custom"]') as HTMLElement;
        custom.dispatchEvent(new Event('mousedown', { cancelable: true }));
        expect(postMessage).toHaveBeenCalledWith({ type: 'setSetting', key: 'commit.commitFormat', value: 'custom' });
        expect(postMessage).toHaveBeenCalledWith({ type: 'setSetting', key: 'commit.useCustomInstructions', value: true });
    });

    it('leaves custom instructions alone when the format change does not flip them', () => {
        Element.prototype.scrollIntoView = vi.fn();
        const root = render(makeState('gemini', {}));
        const angular = root.querySelector('#format li[data-value="angular"]') as HTMLElement;
        angular.dispatchEvent(new Event('mousedown', { cancelable: true }));
        expect(postMessage).toHaveBeenCalledWith({ type: 'setSetting', key: 'commit.commitFormat', value: 'angular' });
        expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'commit.useCustomInstructions' }));
    });
});
