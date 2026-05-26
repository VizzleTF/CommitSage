// Webview frontend. Vanilla DOM, no framework. Runs in the WebviewView iframe;
// talks to the extension only via `acquireVsCodeApi()`.

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

type Provider = 'gemini' | 'codestral' | 'openai' | 'ollama';

interface ModelSlot {
    list: string[];
    loading: boolean;
    error: string | null;
}

interface InitData {
    providers: readonly Provider[];
    languages: readonly string[];
    formats: readonly string[];
    settingKeys: Record<string, string>;
    l10n: {
        provider: string;
        modelAuth: string;
        model: string;
        refresh: string;
        refreshing: string;
        baseUrl: string;
        apiKey: string;
        authToken: string;
        setKey: string;
        removeKey: string;
        keySet: string;
        keyMissing: string;
        noKey: string;
        useAuthToken: string;
        liveFrom: string;
        notInList: string;
        commit: string;
        format: string;
        language: string;
        customLanguage: string;
        promptForRefs: string;
        onlyStaged: string;
        automation: string;
        autoCommit: string;
        autoPush: string;
        autoPushNeedsCommit: string;
        untrusted: string;
        customInstructions: string;
        enableCustom: string;
        customInstructionsPh: string;
        advanced: string;
        apiTimeout: string;
        gitTimeout: string;
        timeoutHint: string;
        telemetry: string;
        autoOption: string;
        providerLabels: Record<Provider, string>;
        liveSource: Record<Provider, string>;
    };
}

interface ViewState {
    trusted: boolean;
    provider: Provider;
    models: Record<Provider, ModelSlot>;
    selected: Record<Provider, string>;
    hasApiKey: Record<Provider, boolean>;
    openai: { baseUrl: string };
    ollama: { baseUrl: string; useAuthToken: boolean };
    commit: {
        format: string;
        language: string;
        customLanguageName: string;
        promptForRefs: boolean;
        onlyStagedChanges: boolean;
        autoCommit: boolean;
        autoPush: boolean;
        useCustomInstructions: boolean;
        customInstructions: string;
    };
    advanced: {
        apiRequestTimeout: number;
        gitTimeout: number;
        telemetryEnabled: boolean;
    };
}

const vscode = acquireVsCodeApi();
const initEl = document.getElementById('init-data');
if (!initEl?.textContent) {
    throw new Error('init-data missing');
}
const init: InitData = JSON.parse(initEl.textContent);
const L = init.l10n;
const KEYS = init.settingKeys;

const root = document.getElementById('root') as HTMLElement;

function send(message: unknown): void {
    vscode.postMessage(message);
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string | boolean | number | null | undefined>,
    children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') {
                node.className = String(v);
            } else if (k.startsWith('on')) {
                continue; // handlers attached separately
            } else {
                node.setAttribute(k, v === true ? '' : String(v));
            }
        }
    }
    for (const c of children) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
}

function fieldLabel(text: string): HTMLLabelElement {
    return el('label', { class: 'field' }, [text]);
}

function makeSelect(
    id: string,
    options: Array<{ value: string; label: string }>,
    current: string,
    onChange: (value: string) => void,
): HTMLSelectElement {
    const select = el('select', { id }) as HTMLSelectElement;
    for (const o of options) {
        const opt = el('option', { value: o.value }, [o.label]);
        select.appendChild(opt);
    }
    // If the current value isn't in the list, append it so the user sees what
    // is actually stored. This is the #405 case (deprecated model still in
    // settings).
    if (current && !options.find(o => o.value === current)) {
        select.appendChild(el('option', { value: current }, [`${current} ${L.notInList}`]));
    }
    select.value = current;
    select.addEventListener('change', () => onChange(select.value));
    return select;
}

function makeCheckbox(
    id: string,
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    opts: { disabled?: boolean; hint?: string } = {},
): HTMLDivElement {
    const input = el('input', { type: 'checkbox', id, disabled: opts.disabled }) as HTMLInputElement;
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    const row = el('div', { class: 'checkbox-row' + (opts.disabled ? ' disabled' : '') }, [
        input,
        el('label', { for: id }, [label]),
    ]);
    if (opts.hint) {
        row.appendChild(el('span', { class: 'hint' }, [opts.hint]));
    }
    return row;
}

function makeTextInput(
    id: string,
    value: string,
    onChange: (v: string) => void,
): HTMLInputElement {
    const input = el('input', { type: 'text', id, value }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    return input;
}

function makeNumberInput(
    id: string,
    value: number,
    onChange: (v: number) => void,
): HTMLInputElement {
    const input = el('input', { type: 'number', id }) as HTMLInputElement;
    input.value = String(value);
    input.addEventListener('change', () => {
        const parsed = parseFloat(input.value);
        if (!Number.isNaN(parsed)) {
            onChange(parsed);
        }
    });
    return input;
}

function makeTextarea(
    id: string,
    value: string,
    onChange: (v: string) => void,
): HTMLTextAreaElement {
    const ta = el('textarea', { id, rows: 5 }) as HTMLTextAreaElement;
    ta.value = value;
    ta.addEventListener('change', () => onChange(ta.value));
    return ta;
}

function section(title: string, openByDefault: boolean, body: HTMLElement): HTMLDetailsElement {
    const details = el('details', { open: openByDefault || undefined }) as HTMLDetailsElement;
    details.appendChild(el('summary', undefined, [title]));
    const wrap = el('div', { class: 'body' }, [body]);
    details.appendChild(wrap);
    return details;
}

function setSetting(key: string, value: string | boolean | number): void {
    send({ type: 'setSetting', key, value });
}

function renderProviderPick(state: ViewState): HTMLElement {
    return el('section', { class: 'provider-pick' }, [
        fieldLabel(L.provider),
        makeSelect(
            'provider',
            init.providers.map(p => ({ value: p, label: L.providerLabels[p] })),
            state.provider,
            v => setSetting(KEYS.provider, v),
        ),
    ]);
}

function renderModelAuthSection(state: ViewState): HTMLElement {
    const p = state.provider;
    const slot = state.models[p];
    const body = el('div');

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
    }

    body.appendChild(fieldLabel(L.model));

    const modelOptions: Array<{ value: string; label: string }> = [];
    if (p === 'gemini') {
        modelOptions.push({ value: 'auto', label: L.autoOption });
    }
    for (const m of slot.list) {
        modelOptions.push({ value: m, label: m });
    }

    const currentKey =
        p === 'gemini' ? KEYS.geminiModel :
        p === 'openai' ? KEYS.openaiModel :
        p === 'codestral' ? KEYS.codestralModel :
        KEYS.ollamaModel;
    const currentValue = state.selected[p];

    const modelSelect = makeSelect(
        'model',
        modelOptions,
        currentValue,
        v => setSetting(currentKey, v),
    );

    // Codestral's dedicated subdomain has no /v1/models endpoint, so the list
    // is a static fallback baked into modelLists.ts. Hide refresh — the action
    // would be a no-op and the misleading "Refreshing…" state would confuse.
    if (p !== 'codestral') {
        const refreshBtn = el('button', {
            id: 'refresh-models',
            title: slot.loading ? L.refreshing : L.refresh,
            disabled: slot.loading,
        }, ['⟳']) as HTMLButtonElement;
        refreshBtn.addEventListener('click', () => send({ type: 'refreshModels', provider: p }));
        body.appendChild(el('div', { class: 'row' }, [modelSelect, refreshBtn]));
    } else {
        body.appendChild(modelSelect);
    }
    body.appendChild(el('div', { class: 'hint' }, [`${L.liveFrom} ${L.liveSource[p]}`]));

    if (slot.error) {
        body.appendChild(el('div', { class: 'error' }, [slot.error]));
    }

    // Auth controls
    if (p === 'ollama') {
        body.appendChild(makeCheckbox(
            'ollama-useauth',
            L.useAuthToken,
            state.ollama.useAuthToken,
            v => setSetting(KEYS.ollamaUseAuthToken, v),
        ));
        if (state.ollama.useAuthToken) {
            body.appendChild(fieldLabel(L.authToken));
            const setBtn = el('button', { class: 'primary' }, [L.setKey]) as HTMLButtonElement;
            setBtn.addEventListener('click', () => send({ type: 'setApiKey', provider: 'ollama' }));
            const removeBtn = el('button', { disabled: !state.hasApiKey.ollama }, [L.removeKey]) as HTMLButtonElement;
            removeBtn.addEventListener('click', () => send({ type: 'removeApiKey', provider: 'ollama' }));
            const badge = el('span', { class: 'badge' + (state.hasApiKey.ollama ? ' on' : '') }, [
                state.hasApiKey.ollama ? L.keySet : L.keyMissing,
            ]);
            body.appendChild(el('div', { class: 'actions' }, [setBtn, removeBtn, badge]));
        }
    } else {
        body.appendChild(fieldLabel(L.apiKey));
        const setBtn = el('button', { class: 'primary' }, [L.setKey]) as HTMLButtonElement;
        setBtn.addEventListener('click', () => send({ type: 'setApiKey', provider: p }));
        const removeBtn = el('button', { disabled: !state.hasApiKey[p] }, [L.removeKey]) as HTMLButtonElement;
        removeBtn.addEventListener('click', () => send({ type: 'removeApiKey', provider: p }));
        const badge = el('span', { class: 'badge' + (state.hasApiKey[p] ? ' on' : '') }, [
            state.hasApiKey[p] ? L.keySet : L.keyMissing,
        ]);
        body.appendChild(el('div', { class: 'actions' }, [setBtn, removeBtn, badge]));

        if (!state.hasApiKey[p]) {
            body.appendChild(el('div', { class: 'hint' }, [L.noKey]));
        }
    }

    return section(L.modelAuth, true, body);
}

function renderCommitSection(state: ViewState): HTMLElement {
    const body = el('div');

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
        },
    ));

    if (state.commit.format === 'custom') {
        body.appendChild(fieldLabel(L.customInstructions));
        body.appendChild(makeTextarea(
            'custom-text',
            state.commit.customInstructions,
            v => setSetting(KEYS.customInstructions, v),
        ));
        body.appendChild(el('div', { class: 'hint' }, [L.customInstructionsPh]));
    }

    body.appendChild(fieldLabel(L.language));
    body.appendChild(makeSelect(
        'language',
        init.languages.map(l => ({ value: l, label: l })),
        state.commit.language,
        v => setSetting(KEYS.commitLanguage, v),
    ));

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

    return section(L.commit, true, body);
}

function renderAutomationSection(state: ViewState): HTMLElement {
    const body = el('div');
    const trustHint = state.trusted ? undefined : L.untrusted;

    body.appendChild(makeCheckbox(
        'auto-commit',
        L.autoCommit,
        state.commit.autoCommit,
        v => setSetting(KEYS.autoCommit, v),
        { disabled: !state.trusted, hint: trustHint },
    ));

    body.appendChild(makeCheckbox(
        'auto-push',
        L.autoPush,
        state.commit.autoPush,
        v => setSetting(KEYS.autoPush, v),
        {
            disabled: !state.trusted || !state.commit.autoCommit,
            hint: !state.trusted ? L.untrusted : (!state.commit.autoCommit ? L.autoPushNeedsCommit : undefined),
        },
    ));

    return section(L.automation, true, body);
}

function renderAdvancedSection(state: ViewState): HTMLElement {
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

    return section(L.advanced, false, body);
}

function render(state: ViewState): void {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(renderProviderPick(state));
    fragment.appendChild(renderModelAuthSection(state));
    fragment.appendChild(renderCommitSection(state));
    fragment.appendChild(renderAutomationSection(state));
    fragment.appendChild(renderAdvancedSection(state));
    root.innerHTML = '';
    root.appendChild(fragment);
}

window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.type === 'state') {
        render(msg.state as ViewState);
    }
});

send({ type: 'getState' });
