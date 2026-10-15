// Per-section renderers. Each takes the current ViewState and returns a
// detached DOM subtree; main.ts assembles them into the document.

import type { Provider, ViewState, WebviewSettingKey, WebviewSettings } from './protocol';
import { el } from './dom';
import {
    field,
    fieldLabel,
    makeSelect,
    makeCheckbox,
    makeTextInput,
    makeNumberInput,
    makeTextarea,
} from './widgets';
import { makeCombobox } from './combobox';
import { section } from './section';
import { init, L, NO_REFRESH_PROVIDERS } from './init';
import { send, setSetting } from './vscodeApi';
import {
    COMMIT_FORMATS,
    COMMITLINT_COMPATIBLE_FORMATS,
    CONFIG_DRIVEN_FORMATS,
    SUPPORTED_LANGUAGES,
    THINKING_LEVELS,
    formatSupportsCommitlint,
    formatUsesCustomInstructions,
} from '../../utils/constants';

type NumberKey = { [K in WebviewSettingKey]: WebviewSettings[K] extends number ? K : never }[WebviewSettingKey];

function numberField(
    body: HTMLElement,
    state: ViewState,
    key: NumberKey,
    id: string,
    label: string,
    hint?: string,
): void {
    field(body, state, key, label, (v, save, disabled) => makeNumberInput(id, v, save, { disabled }), hint);
}

export function renderProviderPick(state: ViewState): HTMLElement {
    const options = init.providers.map(p => ({
        value: p,
        label: L.providerLabels[p],
        dot: state.hasApiKey[p],
    }));
    // Surface providers with a configured key at the top; keep the original
    // order within each group (stable sort).
    options.sort((a, b) => Number(b.dot) - Number(a.dot));
    const wrap = el('section', { class: 'provider-pick' });
    // state.provider, not the raw setting: an invalid value shows the provider
    // generation actually falls back to.
    field(wrap, state, 'provider.type', L.provider, (_v, save, disabled) =>
        makeSelect('provider', options, state.provider, save, { disabled }));
    return wrap;
}

// Provider-specific endpoint config (baseUrl / path) above the model picker.
// Only providers whose endpoint is configurable get these.
function appendEndpointConfig(body: HTMLElement, state: ViewState, p: Provider): void {
    if (p === 'openai') {
        field(body, state, 'openai.baseUrl', L.baseUrl, (v, save, disabled) =>
            makeTextInput('openai-baseurl', v, save, { disabled }));
    } else if (p === 'ollama') {
        field(body, state, 'ollama.baseUrl', L.baseUrl, (v, save, disabled) =>
            makeTextInput('ollama-baseurl', v, save, { disabled }));
    } else if (p === 'custom') {
        field(body, state, 'custom.baseUrl', L.baseUrl, (v, save, disabled) =>
            makeTextInput('custom-baseurl', v, save, { disabled }));
        field(body, state, 'custom.chatCompletionsPath', L.path, (v, save, disabled) =>
            makeTextInput('custom-path', v, save, { disabled }));
    } else if (p === 'openrouter') {
        field(body, state, 'openrouter.preferFreeModels', undefined, (v, save, disabled) =>
            makeCheckbox('openrouter-prefer-free', L.preferFreeModels, v, save, { disabled }));
    }
}

function appendModelPicker(body: HTMLElement, state: ViewState, p: Provider): void {
    const slot = state.models[p];
    const options = p === 'gemini' ? ['auto', ...slot.list] : slot.list;

    // Combobox (text input + filterable popup) instead of a select: lets the
    // user type to filter the model list (essential for OpenRouter's 300+
    // models) and enter a brand-new model ID that isn't in the fetched list yet.
    field(body, state, `${p}.model` as const, L.model, (v, save, disabled) => {
        const combobox = makeCombobox('model', options, v, save, L.modelPlaceholder, { disabled });
        if (NO_REFRESH_PROVIDERS.has(p)) {
            return combobox;
        }
        const refreshBtn = el('button', {
            id: 'refresh-models',
            title: slot.loading ? L.refreshing : L.refresh,
            disabled: slot.loading,
        }, ['⟳']) as HTMLButtonElement;
        refreshBtn.addEventListener('click', () => send({ type: 'refreshModels', provider: p }));
        return el('div', { class: 'row' }, [combobox, refreshBtn]);
    }, `${L.liveFrom} ${L.liveSource[p]}`);

    if (slot.error) {
        body.appendChild(el('div', { class: 'error' }, [slot.error]));
    }
}

function appendAuthControls(body: HTMLElement, state: ViewState, p: Provider): void {
    if (p === 'ollama') {
        field(body, state, 'ollama.useAuthToken', undefined, (v, save, disabled) =>
            makeCheckbox('ollama-useauth', L.useAuthToken, v, save, { disabled }));
        if (state.settings['ollama.useAuthToken']) {
            body.appendChild(fieldLabel(L.authToken));
            body.appendChild(renderApiKeyButtons(state, 'ollama'));
        }
    } else if (p === 'custom') {
        field(body, state, 'custom.useApiKey', undefined, (v, save, disabled) =>
            makeCheckbox('custom-useapikey', L.useApiKey, v, save, { disabled }));
        if (state.settings['custom.useApiKey']) {
            body.appendChild(fieldLabel(L.apiKey));
            body.appendChild(renderApiKeyButtons(state, 'custom'));
        }
    } else {
        body.appendChild(fieldLabel(L.apiKey));
        // OpenRouter supports one-click OAuth login in addition to pasting a key;
        // surface it as a prominent button above the key controls.
        if (p === 'openrouter') {
            const loginBtn = el('button', { class: 'primary' }, [L.loginOpenRouter]) as HTMLButtonElement;
            loginBtn.addEventListener('click', () => send({ type: 'loginOpenRouter' }));
            body.appendChild(el('div', { class: 'actions' }, [loginBtn]));
        }
        body.appendChild(renderApiKeyButtons(state, p));

        if (!state.hasApiKey[p]) {
            body.appendChild(el('div', { class: 'hint' }, [L.noKey]));
        }
    }
}

export function renderModelAuthSection(state: ViewState): HTMLElement {
    const p = state.provider;
    const body = el('div');

    appendEndpointConfig(body, state, p);
    appendModelPicker(body, state, p);
    appendAuthControls(body, state, p);

    return section('modelAuth', L.modelAuth, true, body);
}

function renderApiKeyButtons(state: ViewState, p: Provider): HTMLDivElement {
    const setBtn = el('button', { class: 'primary' }, [L.setKey]) as HTMLButtonElement;
    setBtn.addEventListener('click', () => send({ type: 'setApiKey', provider: p }));
    const removeBtn = el('button', { disabled: !state.hasApiKey[p] }, [L.removeKey]) as HTMLButtonElement;
    removeBtn.addEventListener('click', () => send({ type: 'removeApiKey', provider: p }));
    const badge = el('span', { class: 'badge' + (state.hasApiKey[p] ? ' on' : '') }, [
        state.hasApiKey[p] ? L.keySet : L.keyMissing,
    ]);
    const actions = el('div', { class: 'actions' }, [setBtn, removeBtn, badge]);

    const keyUrl = init.apiKeyUrls[p];
    if (keyUrl) {
        const getBtn = el('button', { title: keyUrl }, [L.getKey]) as HTMLButtonElement;
        getBtn.addEventListener('click', () => send({ type: 'openExternal', url: keyUrl }));
        actions.appendChild(getBtn);
    }

    return actions;
}

export function renderCommitSection(state: ViewState): HTMLElement {
    const body = el('div');
    const s = state.settings;
    const format = s['commit.commitFormat'];

    field(body, state, 'commit.commitFormat', L.format, (v, save, disabled) => makeSelect(
        'format',
        COMMIT_FORMATS.map(f => ({ value: f, label: f })),
        v,
        f => {
            save(f);
            // `custom` format means "use customInstructions verbatim"; flip the
            // gate that promptService reads in lock-step so the user doesn't
            // have to toggle two checkboxes. Only on a real change: a write to
            // a pinned key warns about a setting the user did not touch.
            const uci = formatUsesCustomInstructions(f);
            if (uci !== s['commit.useCustomInstructions']) {
                setSetting('commit.useCustomInstructions', uci);
            }
        },
        { disabled },
    ));

    if (formatUsesCustomInstructions(format)) {
        field(body, state, 'commit.customInstructions', L.customInstructions, (v, save, disabled) =>
            makeTextarea('custom-text', v, save, { disabled }), L.customInstructionsPh);
    }

    // Recent-commits style examples. The `previous` format always uses them
    // (the examples ARE its style), so the count/scope controls show for it too.
    if (format !== 'previous') {
        field(body, state, 'commit.useRecentCommitsAsContext', undefined, (v, save, disabled) =>
            makeCheckbox('use-recent-commits', L.useRecentCommits, v, save, {
                disabled,
                hint: L.useRecentCommitsHint,
            }));
    }
    if (s['commit.useRecentCommitsAsContext'] || format === 'previous') {
        numberField(body, state, 'commit.recentCommitsCount', 'recent-commits-count', L.recentCommitsCount);
        field(body, state, 'commit.recentCommitsScope', L.recentCommitsScope, (v, save, disabled) => makeSelect(
            'recent-commits-scope',
            [
                { value: 'all', label: L.recentCommitsScopeAll },
                { value: 'mine', label: L.recentCommitsScopeMine },
            ],
            v,
            save,
            { disabled },
        ));
    }

    field(body, state, 'commit.commitLanguage', L.language, (v, save, disabled) => makeSelect(
        'language',
        SUPPORTED_LANGUAGES.map(l => ({ value: l, label: l })),
        v,
        save,
        { disabled },
    ));

    if (s['commit.commitLanguage'] === 'custom') {
        field(body, state, 'commit.customLanguageName', L.customLanguage, (v, save, disabled) =>
            makeTextInput('custom-language', v, save, { disabled }));
    }

    field(body, state, 'commit.onlyStagedChanges', undefined, (v, save, disabled) =>
        makeCheckbox('only-staged', L.onlyStaged, v, save, { disabled }));

    return section('commit', L.commit, true, body);
}

export function renderRefsSection(state: ViewState): HTMLElement {
    const body = el('div');
    const s = state.settings;

    field(body, state, 'commit.refs.enabled', undefined, (v, save, disabled) =>
        makeCheckbox('refs-enabled', L.refsEnabled, v, save, { disabled, hint: L.refsEnabledHint }));

    if (s['commit.refs.enabled']) {
        field(body, state, 'commit.refs.source', L.refsSource, (v, save, disabled) => makeSelect(
            'refs-source',
            [
                { value: 'prompt', label: L.refsSourcePrompt },
                { value: 'branch', label: L.refsSourceBranch },
                { value: 'input', label: L.refsSourceInput },
            ],
            v,
            save,
            { disabled },
        ));

        if (s['commit.refs.source'] === 'input') {
            body.appendChild(fieldLabel(L.refsValue));
            // Draft field: not auto-saved. The two buttons persist its current
            // value to either the current branch (workspaceState) or the project
            // (.commitsage/config.json).
            const refInput = makeTextInput('refs-value', s['commit.refs.value'], () => {}, {
                placeholder: L.refsValuePh,
            });
            body.appendChild(refInput);

            const branch = state.refsBranch;
            const saveBranchBtn = el('button', {
                class: 'primary',
                disabled: !branch,
                title: branch ? `${L.refsSaveForBranch}: ${branch}` : L.refsNoBranch,
            }, [L.refsSaveForBranch]) as HTMLButtonElement;
            saveBranchBtn.addEventListener('click', () =>
                send({ type: 'saveRefForBranch', value: refInput.value }));

            const saveProjectBtn = el('button', { class: 'primary' }, [L.refsSaveForProject]) as HTMLButtonElement;
            saveProjectBtn.addEventListener('click', () =>
                send({ type: 'saveRefForProject', value: refInput.value }));

            body.appendChild(el('div', { class: 'actions refs-actions' }, [saveBranchBtn, saveProjectBtn]));

            // Status line — which saved ref actually wins (branch over project).
            let active: string;
            if (state.refsBranchRef) {
                active = `${L.refsActiveBranch}: ${state.refsBranchRef}`;
            } else if (s['commit.refs.value']) {
                active = `${L.refsActiveProject}: ${s['commit.refs.value']}`;
            } else {
                active = L.refsActiveNone;
            }
            const branchNote = branch ? `${branch} · ` : `${L.refsNoBranch} · `;
            body.appendChild(el('div', { class: 'hint' }, [branchNote + active]));

            if (state.refsBranchRef) {
                const clearBtn = el('button', { class: 'primary' }, [L.refsClearBranch]) as HTMLButtonElement;
                clearBtn.addEventListener('click', () => send({ type: 'clearBranchRef' }));
                body.appendChild(el('div', { class: 'actions' }, [clearBtn]));
            }
        }

        if (s['commit.refs.source'] === 'branch') {
            field(body, state, 'commit.refs.branchPattern', L.refsBranchPattern, (v, save, disabled) =>
                makeTextInput('refs-branch-pattern', v, save, {
                    placeholder: '[A-Z][A-Z0-9]*-[0-9]+',
                    disabled,
                }), L.refsBranchPatternHint);
        }

        field(body, state, 'commit.refs.placement', L.refsPlacement, (v, save, disabled) => makeSelect(
            'refs-placement',
            [
                { value: 'end', label: L.refsPlacementEnd },
                { value: 'start', label: L.refsPlacementStart },
                { value: 'prefix', label: L.refsPlacementPrefix },
            ],
            v,
            save,
            { disabled },
        ));
    }

    return section('refs', L.refs, false, body);
}

export function renderCommitlintSection(state: ViewState): HTMLElement {
    const body = el('div');
    const s = state.settings;
    const format = s['commit.commitFormat'];
    // The setting itself is left alone: switching back to a validated format
    // restores the user's choice.
    const unsupported = !formatSupportsCommitlint(format);

    field(body, state, 'commit.commitlint.enabled', undefined, (v, save, disabled) =>
        makeCheckbox('commitlint-enabled', L.commitlintEnabled, v && !unsupported, save, {
            disabled: disabled || unsupported,
            hint: unsupported ? L.commitlintUnsupported : undefined,
        }));

    if (s['commit.commitlint.enabled'] && !unsupported) {
        if (COMMITLINT_COMPATIBLE_FORMATS.has(format) && state.commitlintCliAvailable) {
            field(body, state, 'commit.commitlint.engine', L.commitlintEngine, (v, save, disabled) => makeSelect(
                'commitlint-engine',
                [
                    { value: 'builtin', label: L.commitlintEngineBuiltin },
                    { value: 'project', label: L.commitlintEngineProject },
                ],
                v,
                save,
                { disabled },
            ));
        } else if (!COMMITLINT_COMPATIBLE_FORMATS.has(format)) {
            body.appendChild(el('div', { class: 'hint' }, [L.commitlintBuiltinOnly]));
        }

        numberField(body, state, 'commit.commitlint.maxRetries', 'commitlint-max-retries', L.commitlintMaxRetries);

        if (CONFIG_DRIVEN_FORMATS.has(format)) {
            field(body, state, 'commit.commitlint.rulesPath', L.commitlintRulesPath, (v, save, disabled) =>
                makeTextInput('commitlint-rules-path', v, save, { placeholder: './config', disabled }),
            L.commitlintRulesPathHint);
        }
    }

    return section('commitlint', L.commitlint, true, body);
}

export function renderAutomationSection(state: ViewState): HTMLElement {
    const body = el('div');
    const autoCommit = state.settings['commit.autoCommit'];

    field(body, state, 'commit.autoCommit', undefined, (v, save, disabled) =>
        makeCheckbox('auto-commit', L.autoCommit, v, save, {
            disabled: disabled || !state.trusted,
            hint: state.trusted ? undefined : L.untrusted,
        }));

    let autoPushHint: string | undefined;
    if (state.trusted) {
        autoPushHint = autoCommit ? undefined : L.autoPushNeedsCommit;
    } else {
        autoPushHint = L.untrusted;
    }
    field(body, state, 'commit.autoPush', undefined, (v, save, disabled) =>
        makeCheckbox('auto-push', L.autoPush, v, save, {
            disabled: disabled || !state.trusted || !autoCommit,
            hint: autoPushHint,
        }));

    return section('automation', L.automation, true, body);
}

export function renderAdvancedSection(state: ViewState): HTMLElement {
    const body = el('div');

    numberField(body, state, 'apiRequestTimeout', 'api-timeout', L.apiTimeout);
    numberField(body, state, 'gitTimeout', 'git-timeout', L.gitTimeout, L.timeoutHint);
    numberField(body, state, 'general.maxDiffSize', 'max-diff-size', L.maxDiffSize, L.maxDiffSizeHint);
    numberField(body, state, 'general.temperature', 'temperature', L.temperature, L.temperatureHint);
    numberField(body, state, 'general.maxOutputTokens', 'max-output-tokens', L.maxOutputTokens, L.maxOutputTokensHint);

    // Gemini-only: the two thinking knobs. Both are shown because a single
    // Gemini install switches between 2.5 and 3.x models (and `auto` picks for
    // you), and each family only honours one of them.
    if (state.provider === 'gemini') {
        numberField(
            body, state, 'gemini.thinkingBudget', 'gemini-thinking-budget',
            L.geminiThinkingBudget, L.geminiThinkingBudgetHint,
        );
        field(body, state, 'gemini.thinkingLevel', L.geminiThinkingLevel, (v, save, disabled) => makeSelect(
            'gemini-thinking-level',
            THINKING_LEVELS.map(value => ({ value, label: value })),
            v,
            save,
            { disabled },
        ), L.geminiThinkingLevelHint);
    }

    // Ollama-only: context window override.
    if (state.provider === 'ollama') {
        numberField(body, state, 'ollama.numCtx', 'ollama-num-ctx', L.ollamaNumCtx, L.ollamaNumCtxHint);
    }

    return section('advanced', L.advanced, true, body);
}
