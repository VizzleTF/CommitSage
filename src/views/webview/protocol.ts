// Shared message + state contract between the extension host
// (settingsWebviewProvider.ts) and the webview frontend (webview/main.ts).
//
// TYPES ONLY — no `vscode` import and no runtime code — so the browser bundle
// can import it without pulling in Node deps, and both sides stay in lock-step
// instead of carrying drifting hand-copied duplicates of these shapes.

export type Provider =
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

export interface ModelSlot {
    list: string[];
    loading: boolean;
    error: string | null;
}

/** Localized + branded strings the host hands the webview at render time. */
export interface WebviewL10n {
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
    loginOpenRouter: string;
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
    commitlint: string;
    commitlintEnabled: string;
    commitlintEngine: string;
    commitlintMaxRetries: string;
    commitlintRulesPath: string;
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
}

/** One-shot payload embedded in the page; never changes after first render. */
export interface InitData {
    providers: readonly Provider[];
    languages: readonly string[];
    formats: readonly string[];
    /** Formats the project's commitlint parser can validate directly. */
    commitlintCompatFormats: readonly string[];
    /** Providers with no live model endpoint — UI hides their refresh button. */
    noRefreshProviders: readonly Provider[];
    settingKeys: Record<string, string>;
    apiKeyUrls: Partial<Record<Provider, string>>;
    l10n: WebviewL10n;
}

/** Live, re-pushed-on-change snapshot the webview renders from. */
export interface ViewState {
    trusted: boolean;
    /** KEYS names pinned by .commitsage/config.json — their controls are inert. */
    projectOverrides: string[];
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
        commitlintEnabled: boolean;
        commitlintMaxRetries: number;
        commitlintRulesPath: string;
        commitlintEngine: string;
        commitlintCliAvailable: boolean;
    };
    advanced: {
        apiRequestTimeout: number;
        gitTimeout: number;
        maxDiffSize: number;
        temperature: number;
        telemetryEnabled: boolean;
    };
}

/** Messages the webview posts up to the extension host. */
export type IncomingMessage =
    | { type: 'getState' }
    | { type: 'setSetting'; key: string; value: string | boolean | number }
    | { type: 'refreshModels'; provider: Provider }
    | { type: 'setApiKey'; provider: Provider }
    | { type: 'removeApiKey'; provider: Provider }
    | { type: 'loginOpenRouter' }
    | { type: 'openExternal'; url: string };
