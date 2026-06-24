// Per-section renderers. Each takes the current ViewState and returns a
// detached DOM subtree; main.ts assembles them into the document.

import type { Provider, ViewState } from './protocol';
import { el } from './dom';
import {
    fieldLabel,
    pinnedHint,
    isPinned,
    makeSelect,
    makeCheckbox,
    makeTextInput,
    makeNumberInput,
    makeTextarea,
} from './widgets';
import { makeCombobox } from './combobox';
import { section } from './section';
import { init, L, KEYS, COMMITLINT_COMPAT_FORMATS, NO_REFRESH_PROVIDERS } from './init';
import { send, setSetting } from './vscodeApi';

export function renderProviderPick(state: ViewState): HTMLElement {
    const providerPinned = isPinned(state, 'provider');
    return el('section', { class: 'provider-pick' }, [
        fieldLabel(L.provider),
        makeSelect(
            'provider',
            init.providers.map(p => ({ value: p, label: L.providerLabels[p] })),
            state.provider,
            v => setSetting(KEYS.provider, v),
            { disabled: providerPinned },
        ),
        providerPinned ? pinnedHint() : undefined,
    ]);
}

// Provider-specific endpoint config (baseUrl / path) above the model picker.
// Only providers whose endpoint is configurable get these.
function appendEndpointConfig(body: HTMLElement, state: ViewState, p: Provider): void {
    if (p === 'openai') {
        body.appendChild(fieldLabel(L.baseUrl));
        body.appendChild(makeTextInput(
            'openai-baseurl',
            state.openai.baseUrl,
            v => setSetting(KEYS.openaiBaseUrl, v),
        ));
    } else if (p === 'ollama') {
        body.appendChild(fieldLabel(L.baseUrl));
        body.appendChild(makeTextInput(
            'ollama-baseurl',
            state.ollama.baseUrl,
            v => setSetting(KEYS.ollamaBaseUrl, v),
        ));
    } else if (p === 'custom') {
        body.appendChild(fieldLabel(L.baseUrl));
        body.appendChild(makeTextInput(
            'custom-baseurl',
            state.custom.baseUrl,
            v => setSetting(KEYS.customBaseUrl, v),
        ));
        body.appendChild(fieldLabel(L.path));
        body.appendChild(makeTextInput(
            'custom-path',
            state.custom.chatCompletionsPath,
            v => setSetting(KEYS.customChatCompletionsPath, v),
        ));
    }

    if (p === 'openrouter') {
        body.appendChild(makeCheckbox(
            'openrouter-prefer-free',
            L.preferFreeModels,
            state.openrouter.preferFreeModels,
            v => setSetting(KEYS.openrouterPreferFreeModels, v),
        ));
    }
}

function appendModelPicker(body: HTMLElement, state: ViewState, p: Provider): void {
    const slot = state.models[p];
    body.appendChild(fieldLabel(L.model));

    // Model setting key name is uniformly `<provider>Model` (matches SETTING_KEYS).
    const settingKeyName = `${p}Model`;
    const currentKey = KEYS[settingKeyName];
    const currentValue = state.selected[p];

    // Combobox (text input + datalist) instead of a plain <select>: lets the
    // user type to filter the model list (essential for OpenRouter's 300+
    // models) and lets them enter a brand-new model ID that isn't in the
    // fetched list yet.
    const modelOptions: string[] = [];
    if (p === 'gemini') {
        modelOptions.push('auto');
    }
    modelOptions.push(...slot.list);

    const modelPinned = isPinned(state, settingKeyName);
    const modelCombobox = makeCombobox(
        'model',
        modelOptions,
        currentValue,
        v => setSetting(currentKey, v),
        L.modelPlaceholder,
        { disabled: modelPinned },
    );

    if (NO_REFRESH_PROVIDERS.has(p)) {
        body.appendChild(modelCombobox);
    } else {
        const refreshBtn = el('button', {
            id: 'refresh-models',
            title: slot.loading ? L.refreshing : L.refresh,
            disabled: slot.loading,
        }, ['⟳']) as HTMLButtonElement;
        refreshBtn.addEventListener('click', () => send({ type: 'refreshModels', provider: p }));
        body.appendChild(el('div', { class: 'row' }, [modelCombobox, refreshBtn]));
    }

    if (modelPinned) { body.appendChild(pinnedHint()); }

    body.appendChild(el('div', { class: 'hint' }, [`${L.liveFrom} ${L.liveSource[p]}`]));

    if (slot.error) {
        body.appendChild(el('div', { class: 'error' }, [slot.error]));
    }
}

function appendAuthControls(body: HTMLElement, state: ViewState, p: Provider): void {
    if (p === 'ollama') {
        body.appendChild(makeCheckbox(
            'ollama-useauth',
            L.useAuthToken,
            state.ollama.useAuthToken,
            v => setSetting(KEYS.ollamaUseAuthToken, v),
        ));
        if (state.ollama.useAuthToken) {
            body.appendChild(fieldLabel(L.authToken));
            body.appendChild(renderApiKeyButtons(state, 'ollama'));
        }
    } else if (p === 'custom') {
        body.appendChild(makeCheckbox(
            'custom-useapikey',
            L.useApiKey,
            state.custom.useApiKey,
            v => setSetting(KEYS.customUseApiKey, v),
        ));
        if (state.custom.useApiKey) {
            body.appendChild(fieldLabel(L.apiKey));
            body.appendChild(renderApiKeyButtons(state, 'custom'));
        }
    } else {
        body.appendChild(fieldLabel(L.apiKey));
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

    const formatPinned = isPinned(state, 'commitFormat');
    body.appendChild(fieldLabel(L.format));
    body.appendChild(makeSelect(
        'format',
        init.formats.map(f => ({ value: f, label: f })),
        state.commit.format,
        v => {
            setSetting(KEYS.commitFormat, v);
            // `custom` format means "use customInstructions verbatim"; flip the
            // gate that promptService reads in lock-step so the user doesn't
            // have to toggle two checkboxes.
            setSetting(KEYS.useCustomInstructions, v === 'custom');
            // Validation doesn't apply to free-form prompts.
            if (v === 'custom' && state.commit.commitlintEnabled) {
                setSetting(KEYS.commitlintEnabled, false);
            }
        },
        { disabled: formatPinned },
    ));
    if (formatPinned) { body.appendChild(pinnedHint()); }

    if (state.commit.format === 'custom') {
        body.appendChild(fieldLabel(L.customInstructions));
        body.appendChild(makeTextarea(
            'custom-text',
            state.commit.customInstructions,
            v => setSetting(KEYS.customInstructions, v),
        ));
        body.appendChild(el('div', { class: 'hint' }, [L.customInstructionsPh]));
    }

    const languagePinned = isPinned(state, 'commitLanguage');
    body.appendChild(fieldLabel(L.language));
    body.appendChild(makeSelect(
        'language',
        init.languages.map(l => ({ value: l, label: l })),
        state.commit.language,
        v => setSetting(KEYS.commitLanguage, v),
        { disabled: languagePinned },
    ));
    if (languagePinned) { body.appendChild(pinnedHint()); }

    if (state.commit.language === 'custom') {
        body.appendChild(fieldLabel(L.customLanguage));
        body.appendChild(makeTextInput(
            'custom-language',
            state.commit.customLanguageName,
            v => setSetting(KEYS.customLanguageName, v),
        ));
    }

    body.appendChild(makeCheckbox(
        'prompt-for-refs',
        L.promptForRefs,
        state.commit.promptForRefs,
        v => setSetting(KEYS.promptForRefs, v),
    ));
    body.appendChild(makeCheckbox(
        'only-staged',
        L.onlyStaged,
        state.commit.onlyStagedChanges,
        v => setSetting(KEYS.onlyStagedChanges, v),
    ));

    return section('commit', L.commit, true, body);
}

export function renderCommitlintSection(state: ViewState): HTMLElement {
    const body = el('div');
    const isCustomFormat = state.commit.format === 'custom';

    body.appendChild(makeCheckbox(
        'commitlint-enabled',
        L.commitlintEnabled,
        state.commit.commitlintEnabled && !isCustomFormat,
        v => setSetting(KEYS.commitlintEnabled, v),
        {
            disabled: isCustomFormat,
            hint: isCustomFormat ? 'Not available for the custom format.' : undefined,
        },
    ));

    if (state.commit.commitlintEnabled && !isCustomFormat) {
        if (COMMITLINT_COMPAT_FORMATS.has(state.commit.format) && state.commit.commitlintCliAvailable) {
            body.appendChild(fieldLabel(L.commitlintEngine));
            body.appendChild(makeSelect(
                'commitlint-engine',
                [
                    { value: 'builtin', label: 'Built-in static rules' },
                    { value: 'project', label: 'Project commitlint (node_modules)' },
                ],
                state.commit.commitlintEngine,
                v => setSetting(KEYS.commitlintEngine, v),
            ));
        } else if (!COMMITLINT_COMPAT_FORMATS.has(state.commit.format)) {
            body.appendChild(el('div', { class: 'hint' }, [
                'This format is checked by built-in rules; project commitlint cannot parse it.',
            ]));
        }

        body.appendChild(fieldLabel(L.commitlintMaxRetries));
        body.appendChild(makeNumberInput(
            'commitlint-max-retries',
            state.commit.commitlintMaxRetries,
            v => setSetting(KEYS.commitlintMaxRetries, v),
        ));

        if (state.commit.format === 'conventional' || state.commit.format === 'angular') {
            body.appendChild(fieldLabel(L.commitlintRulesPath));
            body.appendChild(makeTextInput(
                'commitlint-rules-path',
                state.commit.commitlintRulesPath,
                v => setSetting(KEYS.commitlintRulesPath, v),
                './config',
            ));
            body.appendChild(el('div', { class: 'hint' }, [
                'Path to the commitlint config file. Relative to the repo root, or absolute. Empty = auto-discover.',
            ]));
        }
    }

    return section('commitlint', L.commitlint, true, body);
}

export function renderAutomationSection(state: ViewState): HTMLElement {
    const body = el('div');
    const trustHint = state.trusted ? undefined : L.untrusted;

    body.appendChild(makeCheckbox(
        'auto-commit',
        L.autoCommit,
        state.commit.autoCommit,
        v => setSetting(KEYS.autoCommit, v),
        { disabled: !state.trusted, hint: trustHint },
    ));

    let autoPushHint: string | undefined;
    if (state.trusted) {
        autoPushHint = state.commit.autoCommit ? undefined : L.autoPushNeedsCommit;
    } else {
        autoPushHint = L.untrusted;
    }
    body.appendChild(makeCheckbox(
        'auto-push',
        L.autoPush,
        state.commit.autoPush,
        v => setSetting(KEYS.autoPush, v),
        {
            disabled: !state.trusted || !state.commit.autoCommit,
            hint: autoPushHint,
        },
    ));

    return section('automation', L.automation, true, body);
}

export function renderAdvancedSection(state: ViewState): HTMLElement {
    const body = el('div');

    body.appendChild(fieldLabel(L.apiTimeout));
    body.appendChild(makeNumberInput(
        'api-timeout',
        state.advanced.apiRequestTimeout,
        v => setSetting(KEYS.apiRequestTimeout, v),
    ));
    body.appendChild(fieldLabel(L.gitTimeout));
    body.appendChild(makeNumberInput(
        'git-timeout',
        state.advanced.gitTimeout,
        v => setSetting(KEYS.gitTimeout, v),
    ));
    body.appendChild(el('div', { class: 'hint' }, [L.timeoutHint]));

    body.appendChild(fieldLabel(L.maxDiffSize));
    body.appendChild(makeNumberInput(
        'max-diff-size',
        state.advanced.maxDiffSize,
        v => setSetting(KEYS.maxDiffSize, v),
    ));
    body.appendChild(el('div', { class: 'hint' }, [L.maxDiffSizeHint]));

    body.appendChild(fieldLabel(L.temperature));
    body.appendChild(makeNumberInput(
        'temperature',
        state.advanced.temperature,
        v => setSetting(KEYS.temperature, v),
    ));
    body.appendChild(el('div', { class: 'hint' }, [L.temperatureHint]));

    // Ollama-only: context window override. Surfaced regardless of selected
    // provider since the Advanced section already collects cross-cutting
    // settings — keeps related Ollama settings discoverable.
    if (state.provider === 'ollama') {
        body.appendChild(fieldLabel(L.ollamaNumCtx));
        body.appendChild(makeNumberInput(
            'ollama-num-ctx',
            state.ollama.numCtx,
            v => setSetting(KEYS.ollamaNumCtx, v),
        ));
        body.appendChild(el('div', { class: 'hint' }, [L.ollamaNumCtxHint]));
    }

    return section('advanced', L.advanced, true, body);
}
