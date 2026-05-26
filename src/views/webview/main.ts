// Webview frontend. Vanilla DOM, no framework. Runs in the WebviewView iframe;
// talks to the extension only via `acquireVsCodeApi()`.

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

type Provider =
    | 'gemini'
    | 'codestral'
    | 'openai'
    | 'ollama'
    | 'openrouter'
    | 'groq'
    | 'anthropic'
    | 'deepseek'
    | 'xai'
    | 'custom';

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
    apiKeyUrls: Partial<Record<Provider, string>>;
    l10n: {
        provider: string;
        modelAuth: string;
        model: string;
        modelPlaceholder: string;
        refresh: string;
        refreshing: string;
        baseUrl: string;
        path: string;
        apiKey: string;
        authToken: string;
        setKey: string;
        removeKey: string;
        getKey: string;
        keySet: string;
        keyMissing: string;
        noKey: string;
        useAuthToken: string;
        useApiKey: string;
        preferFreeModels: string;
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
        maxDiffSize: string;
        maxDiffSizeHint: string;
        temperature: string;
        temperatureHint: string;
        ollamaNumCtx: string;
        ollamaNumCtxHint: string;
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
    ollama: { baseUrl: string; useAuthToken: boolean; numCtx: number };
    openrouter: { preferFreeModels: boolean };
    custom: { baseUrl: string; useApiKey: boolean; chatCompletionsPath: string };
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
        maxDiffSize: number;
        temperature: number;
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
            if (v === null || v === undefined || v === false) {
                continue;
            }
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
        if (c === null || c === undefined) {
            continue;
        }
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
    placeholder?: string,
): HTMLInputElement {
    const input = el('input', { type: 'text', id, value, placeholder }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    return input;
}

/**
 * Three-tier fuzzy match scorer for the combobox.
 *
 * Tier 1 — `query` is a contiguous substring of `target` (case-insensitive).
 *   Best score. Earlier match position wins (`claude-3-5-sonnet` ranks above
 *   `meta/some-claude-fork` for query `claude`).
 * Tier 2 — `query` chars appear as a subsequence in `target`, preserving
 *   order, possibly with gaps. Example: `clu` → `c…l…u` matches `claude`.
 *   Earlier first-match position wins.
 * Tier 3 — `target` contains every char of `query` as a multiset, in any
 *   order. Example: `gml` → `glm` (no order match, but all three chars
 *   present). Lowest priority.
 *
 * Returns `null` when none of the tiers match — the item is filtered out.
 */
function fuzzyScore(query: string, target: string): number | null {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    if (!q) {
        return 0;
    }

    // Tier 1: contiguous substring.
    const sub = t.indexOf(q);
    if (sub >= 0) {
        return 1_000_000 - sub;
    }

    // Tier 2: subsequence preserving order.
    let qi = 0;
    let firstMatch = -1;
    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t.charCodeAt(i) === q.charCodeAt(qi)) {
            if (firstMatch < 0) {
                firstMatch = i;
            }
            qi++;
        }
    }
    if (qi === q.length) {
        return 100_000 - firstMatch;
    }

    // Tier 3: target contains every char of query as a multiset (order ignored).
    // Use a counts map so `gg` doesn't match a target with a single `g`.
    const tCounts = new Map<string, number>();
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        tCounts.set(ch, (tCounts.get(ch) ?? 0) + 1);
    }
    for (let i = 0; i < q.length; i++) {
        const ch = q[i];
        const c = tCounts.get(ch) ?? 0;
        if (c === 0) {
            return null;
        }
        tCounts.set(ch, c - 1);
    }
    // Shorter targets rank higher within tier 3 — `glm` beats
    // `something/with/glm-tagged-name-longer` when the query is `gml`.
    return 10_000 - t.length;
}

/**
 * Custom combobox: text input + scrollable popup list with substring
 * filtering, keyboard navigation, and free-form entry. Replaces the
 * browser-native `<datalist>` which had two blockers:
 *  1. Chromium's datalist popup doesn't scroll past ~20 items (OpenRouter
 *     ships 300+ models).
 *  2. There's no way to clear the input on focus while preserving the
 *     committed value — datalist tightly couples display and value.
 *
 * Behaviour:
 *  - Focus clears the input to an empty filter (placeholder shows the
 *     committed model), so the user immediately sees the full list.
 *  - The committed value is preserved — closing without selecting (Esc /
 *     click outside / blur) restores the displayed value.
 *  - Selection (click / Enter on highlighted item) commits + calls onChange.
 *  - Pressing Enter on free-form text not in the list also commits it,
 *     so brand-new model IDs can be typed in.
 *  - ↑/↓ navigate, Esc closes without commit.
 */
function makeCombobox(
    id: string,
    options: string[],
    current: string,
    onChange: (value: string) => void,
    placeholder?: string,
): HTMLDivElement {
    const wrap = el('div', { class: 'combo' }) as HTMLDivElement;
    const input = el('input', {
        type: 'text',
        id,
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: current || placeholder || '',
    }) as HTMLInputElement;
    input.value = current;

    const list = el('ul', { class: 'combo-list' }) as HTMLUListElement;
    list.hidden = true;

    let committed = current;
    let activeIdx = -1;

    function renderList(filter: string): void {
        const f = filter.trim();
        let matches: string[];
        if (!f) {
            matches = options.slice();
        } else {
            const scored: Array<{ value: string; score: number }> = [];
            for (const o of options) {
                const s = fuzzyScore(f, o);
                if (s !== null) {
                    scored.push({ value: o, score: s });
                }
            }
            // Higher score first; lexicographic as tiebreaker so the order
            // is stable across renders.
            scored.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
            matches = scored.map(s => s.value);
        }

        list.innerHTML = '';
        if (matches.length === 0) {
            list.hidden = true;
            activeIdx = -1;
            return;
        }
        for (let i = 0; i < matches.length; i++) {
            const value = matches[i];
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const li = el('li', { class: 'combo-list-item', 'data-value': value }, [value]);
            // mousedown (not click) — click fires AFTER input blur, which
            // would hide the list and cancel the selection. mousedown +
            // preventDefault keeps focus.
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                commit(value);
            });
            list.appendChild(li);
        }
        list.hidden = false;
        // When the user is filtering, always start from the top match. When
        // the filter is empty (e.g. on focus), pre-highlight the committed
        // value so the dropdown opens on the user's current selection.
        if (!f && committed) {
            activeIdx = Math.max(0, matches.indexOf(committed));
        } else {
            activeIdx = 0;
        }
        highlight();
    }

    function highlight(): void {
        const items = list.querySelectorAll('.combo-list-item');
        items.forEach((it, i) => {
            it.classList.toggle('active', i === activeIdx);
            if (i === activeIdx) {
                (it as HTMLElement).scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function commit(value: string): void {
        committed = value;
        input.value = value;
        input.placeholder = value || (placeholder ?? '');
        list.hidden = true;
        activeIdx = -1;
        onChange(value);
    }

    function restore(): void {
        input.value = committed;
        list.hidden = true;
        activeIdx = -1;
    }

    function openList(): void {
        // Clear the typed display so the filter starts empty and the user
        // sees the full list. `committed` is unchanged — restore() puts it
        // back if the user closes without picking.
        input.value = '';
        input.placeholder = committed || (placeholder ?? '');
        renderList('');
    }

    input.addEventListener('focus', openList);
    // Re-opening on click handles the case where the input already has focus
    // but the list was closed (e.g. Esc was pressed).
    input.addEventListener('click', () => {
        if (list.hidden) {
            openList();
        }
    });

    input.addEventListener('blur', () => {
        // Defer so a mousedown on a list item can commit first.
        setTimeout(() => {
            if (!list.hidden) {
                restore();
            } else if (input.value !== committed) {
                // List already closed (e.g. via commit) but if input still
                // shows a stale typed value, sync to committed.
                input.value = committed;
            }
        }, 0);
    });

    input.addEventListener('input', () => renderList(input.value));

    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            if (list.hidden) {
                openList();
            } else {
                const items = list.querySelectorAll('.combo-list-item');
                activeIdx = Math.min(activeIdx + 1, items.length - 1);
                highlight();
            }
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            if (!list.hidden) {
                activeIdx = Math.max(activeIdx - 1, 0);
                highlight();
                e.preventDefault();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const items = list.querySelectorAll('.combo-list-item');
            if (!list.hidden && activeIdx >= 0 && activeIdx < items.length) {
                commit((items[activeIdx] as HTMLElement).dataset.value ?? '');
            } else if (input.value.trim()) {
                // Free-form entry: commit whatever the user typed.
                commit(input.value.trim());
            } else {
                restore();
            }
            input.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            restore();
            input.blur();
        }
    });

    wrap.appendChild(input);
    wrap.appendChild(list);
    return wrap;
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

// Per-section open/closed state, persisted via vscode.setState so the
// webview restores the previous expansion across reloads / window restarts.
// Keys are stable section IDs ("modelAuth" / "commit" / "automation" /
// "advanced") — not localized titles, which would change with locale.
type SectionState = Record<string, boolean>;
function loadSectionState(): SectionState {
    const raw = vscode.getState() as { sections?: SectionState } | undefined;
    return raw?.sections ?? {};
}
function saveSectionState(state: SectionState): void {
    const prev = (vscode.getState() as Record<string, unknown> | undefined) ?? {};
    vscode.setState({ ...prev, sections: state });
}

function section(
    id: string,
    title: string,
    openByDefault: boolean,
    body: HTMLElement,
): HTMLDetailsElement {
    const persisted = loadSectionState();
    const open = id in persisted ? persisted[id] : openByDefault;
    const details = el('details', { open: open || undefined }) as HTMLDetailsElement;
    details.appendChild(el('summary', undefined, [title]));
    const wrap = el('div', { class: 'body' }, [body]);
    details.appendChild(wrap);

    details.addEventListener('toggle', () => {
        const next = loadSectionState();
        next[id] = details.open;
        saveSectionState(next);
    });

    return details;
}

function setSetting(key: string, value: string | boolean | number): void {
    send({ type: 'setSetting', key, value });
}

// Providers that have no live `/models` endpoint and therefore should not
// show a refresh button (the list is static or user-supplied). Codestral has
// a static fallback, Anthropic has no public endpoint, Custom has no listing
// at all.
const NO_REFRESH_PROVIDERS: ReadonlySet<Provider> = new Set([
    'codestral',
    'anthropic',
    'custom',
] as const);

const SETTING_KEY_BY_PROVIDER: Record<Provider, string> = {
    gemini: 'geminiModel',
    openai: 'openaiModel',
    codestral: 'codestralModel',
    ollama: 'ollamaModel',
    openrouter: 'openrouterModel',
    groq: 'groqModel',
    anthropic: 'anthropicModel',
    deepseek: 'deepseekModel',
    xai: 'xaiModel',
    custom: 'customModel',
};

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

    // Provider-specific endpoint config (baseUrl / path) above the model
    // picker. Only providers whose endpoint is configurable get these.
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

    body.appendChild(fieldLabel(L.model));

    const settingKeyName = SETTING_KEY_BY_PROVIDER[p];
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

    const modelCombobox = makeCombobox(
        'model',
        modelOptions,
        currentValue,
        v => setSetting(currentKey, v),
        L.modelPlaceholder,
    );

    if (!NO_REFRESH_PROVIDERS.has(p)) {
        const refreshBtn = el('button', {
            id: 'refresh-models',
            title: slot.loading ? L.refreshing : L.refresh,
            disabled: slot.loading,
        }, ['⟳']) as HTMLButtonElement;
        refreshBtn.addEventListener('click', () => send({ type: 'refreshModels', provider: p }));
        body.appendChild(el('div', { class: 'row' }, [modelCombobox, refreshBtn]));
    } else {
        body.appendChild(modelCombobox);
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

    return section('commit', L.commit, true, body);
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

    return section('automation', L.automation, true, body);
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
