import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { CommitLintCliService } from '../services/commitLintCliService';
import { ApiKeyManager } from '../services/apiKeyManager';
import {
    fetchGeminiModels,
    fetchOpenAIModels,
    fetchCodestralModels,
    fetchOllamaModels,
    fetchOpenRouterModels,
    fetchGroqModels,
    fetchAnthropicModels,
    fetchDeepSeekModels,
    fetchXaiModels,
} from '../services/modelLists';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

const VIEW_ID = 'commitsage.settings';

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

const PROVIDERS: readonly Provider[] = [
    'gemini',
    'openrouter',
    'groq',
    'anthropic',
    'openai',
    'deepseek',
    'xai',
    'codestral',
    'ollama',
    'custom',
] as const;

const LANGUAGES = [
    'english', 'russian', 'chinese', 'japanese', 'korean',
    'german', 'french', 'spanish', 'portuguese', 'custom',
] as const;
const FORMATS = [
    'conventional', 'angular', 'karma', 'semantic',
    'emoji', 'emojiKarma', 'google', 'atom', 'detailed', 'custom',
] as const;

const SECRET_KEYS: Record<Provider, string> = {
    gemini: 'commitsage.apiKey',
    openai: 'commitsage.openaiApiKey',
    codestral: 'commitsage.codestralApiKey',
    ollama: 'commitsage.ollamaAuthToken',
    openrouter: 'commitsage.openrouterApiKey',
    groq: 'commitsage.groqApiKey',
    anthropic: 'commitsage.anthropicApiKey',
    deepseek: 'commitsage.deepseekApiKey',
    xai: 'commitsage.xaiApiKey',
    custom: 'commitsage.customApiKey',
};

const SETTING_KEYS = {
    provider: 'commitSage.provider.type',
    geminiModel: 'commitSage.gemini.model',
    codestralModel: 'commitSage.codestral.model',
    openaiModel: 'commitSage.openai.model',
    openaiBaseUrl: 'commitSage.openai.baseUrl',
    ollamaModel: 'commitSage.ollama.model',
    ollamaBaseUrl: 'commitSage.ollama.baseUrl',
    ollamaUseAuthToken: 'commitSage.ollama.useAuthToken',
    openrouterModel: 'commitSage.openrouter.model',
    openrouterPreferFreeModels: 'commitSage.openrouter.preferFreeModels',
    groqModel: 'commitSage.groq.model',
    anthropicModel: 'commitSage.anthropic.model',
    deepseekModel: 'commitSage.deepseek.model',
    xaiModel: 'commitSage.xai.model',
    customBaseUrl: 'commitSage.custom.baseUrl',
    customModel: 'commitSage.custom.model',
    customUseApiKey: 'commitSage.custom.useApiKey',
    customChatCompletionsPath: 'commitSage.custom.chatCompletionsPath',
    maxDiffSize: 'commitSage.general.maxDiffSize',
    temperature: 'commitSage.general.temperature',
    ollamaNumCtx: 'commitSage.ollama.numCtx',
    commitLanguage: 'commitSage.commit.commitLanguage',
    customLanguageName: 'commitSage.commit.customLanguageName',
    commitFormat: 'commitSage.commit.commitFormat',
    promptForRefs: 'commitSage.commit.promptForRefs',
    onlyStagedChanges: 'commitSage.commit.onlyStagedChanges',
    autoCommit: 'commitSage.commit.autoCommit',
    autoPush: 'commitSage.commit.autoPush',
    useCustomInstructions: 'commitSage.commit.useCustomInstructions',
    customInstructions: 'commitSage.commit.customInstructions',
    apiRequestTimeout: 'commitSage.apiRequestTimeout',
    gitTimeout: 'commitSage.gitTimeout',
    telemetryEnabled: 'commitSage.telemetry.enabled',
    commitlintEnabled: 'commitSage.commit.commitlint.enabled',
    commitlintMaxRetries: 'commitSage.commit.commitlint.maxRetries',
    commitlintRulesPath: 'commitSage.commit.commitlint.rulesPath',
    commitlintEngine: 'commitSage.commit.commitlint.engine',
} as const;

interface ModelSlot {
    list: string[];
    loading: boolean;
    error: string | null;
}

interface ViewState {
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

type IncomingMessage =
    | { type: 'getState' }
    | { type: 'setSetting'; key: string; value: string | boolean | number }
    | { type: 'refreshModels'; provider: Provider }
    | { type: 'setApiKey'; provider: Provider }
    | { type: 'removeApiKey'; provider: Provider }
    | { type: 'openExternal'; url: string };

const API_KEY_URLS: Partial<Record<Provider, string>> = {
    gemini: 'https://aistudio.google.com/app/apikey',
    codestral: 'https://console.mistral.ai/codestral',
    openai: 'https://platform.openai.com/api-keys',
    openrouter: 'https://openrouter.ai/keys',
    groq: 'https://console.groq.com/keys',
    anthropic: 'https://console.anthropic.com/settings/keys',
    deepseek: 'https://platform.deepseek.com/api_keys',
    xai: 'https://console.x.ai/',
};

const SET_KEY_COMMAND: Record<Provider, string> = {
    gemini: 'commitsage.setApiKey',
    openai: 'commitsage.setOpenAIApiKey',
    codestral: 'commitsage.setCodestralApiKey',
    ollama: 'commitsage.setOllamaAuthToken',
    openrouter: 'commitsage.setOpenRouterApiKey',
    groq: 'commitsage.setGroqApiKey',
    anthropic: 'commitsage.setAnthropicApiKey',
    deepseek: 'commitsage.setDeepSeekApiKey',
    xai: 'commitsage.setXaiApiKey',
    custom: 'commitsage.setCustomApiKey',
};
const REMOVE_KEY_COMMAND: Record<Provider, string> = {
    gemini: 'commitsage.removeApiKey',
    openai: 'commitsage.removeOpenAIApiKey',
    codestral: 'commitsage.removeCodestralApiKey',
    ollama: 'commitsage.removeOllamaAuthToken',
    openrouter: 'commitsage.removeOpenRouterApiKey',
    groq: 'commitsage.removeGroqApiKey',
    anthropic: 'commitsage.removeAnthropicApiKey',
    deepseek: 'commitsage.removeDeepSeekApiKey',
    xai: 'commitsage.removeXaiApiKey',
    custom: 'commitsage.removeCustomApiKey',
};

export class SettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = VIEW_ID;

    private view: vscode.WebviewView | undefined;
    private models: Record<Provider, ModelSlot> = {
        gemini: { list: [], loading: false, error: null },
        openai: { list: [], loading: false, error: null },
        codestral: { list: [], loading: false, error: null },
        ollama: { list: [], loading: false, error: null },
        openrouter: { list: [], loading: false, error: null },
        groq: { list: [], loading: false, error: null },
        anthropic: { list: [], loading: false, error: null },
        deepseek: { list: [], loading: false, error: null },
        xai: { list: [], loading: false, error: null },
        custom: { list: [], loading: false, error: null },
    };

    constructor(private readonly context: vscode.ExtensionContext) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
        };

        webviewView.webview.html = this.renderHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (msg: IncomingMessage) => void this.handleMessage(msg),
            undefined,
            this.context.subscriptions,
        );

        const configSub = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('commitSage')) {
                void this.pushState();
            }
        });
        // Secret changes (Set/Remove key buttons) don't fire onDidChangeConfiguration,
        // so the "● set" indicator drifts unless we also listen to SecretStorage.
        const secretSub = this.context.secrets.onDidChange(e => {
            if (Object.values(SECRET_KEYS).includes(e.key)) {
                void this.pushState();
            }
        });
        webviewView.onDidDispose(() => {
            configSub.dispose();
            secretSub.dispose();
        }, null, this.context.subscriptions);

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                void this.pushState();
            }
        });
    }

    private async handleMessage(msg: IncomingMessage): Promise<void> {
        try {
            switch (msg.type) {
                case 'getState':
                    await this.pushState();
                    // Lazy live fetch for the current provider on first open so
                    // the dropdown isn't empty.
                    await this.refreshModelsFor(ConfigService.get('provider.type') as Provider, false);
                    return;

                case 'setSetting':
                    await vscode.workspace
                        .getConfiguration()
                        .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
                    return;

                case 'refreshModels':
                    await this.refreshModelsFor(msg.provider, true);
                    return;

                case 'setApiKey':
                    await vscode.commands.executeCommand(SET_KEY_COMMAND[msg.provider]);
                    await this.refreshModelsFor(msg.provider, true);
                    return;

                case 'removeApiKey':
                    await vscode.commands.executeCommand(REMOVE_KEY_COMMAND[msg.provider]);
                    return;

                case 'openExternal':
                    // Whitelist against the static map — never trust a URL the
                    // webview hands us back. Prevents the webview from being
                    // coerced into opening arbitrary protocols.
                    if (Object.values(API_KEY_URLS).includes(msg.url)) {
                        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
                    }
                    return;
            }
        } catch (error) {
            Logger.error('Webview message handler failed:', toError(error));
        }
    }

    private async refreshModelsFor(provider: Provider, force: boolean): Promise<void> {
        const slot = this.models[provider];
        if (!force && (slot.loading || slot.list.length > 0)) {
            return;
        }

        slot.loading = true;
        slot.error = null;
        await this.pushState();

        try {
            slot.list = await this.fetchByProvider(provider);
            slot.error = null;
        } catch (error) {
            const err = toError(error);
            // Translate the bare `HTTP 400/401` text from HttpUtils into a
            // user-actionable string. xAI in particular returns 400 with a
            // message like "Incorrect API key provided: ..." in the body.
            slot.error = this.describeRefreshError(err);
            Logger.error(`Model refresh failed for ${provider}:`, err);
        } finally {
            slot.loading = false;
            await this.pushState();
        }
    }

    private describeRefreshError(err: Error): string {
        const httpMatch = err.message.match(/^HTTP (\d{3})$/);
        if (!httpMatch) {
            return err.message;
        }
        const status = httpMatch[1];
        if (status === '401') {
            return 'Authentication failed — check the API key.';
        }
        if (status === '403') {
            // xAI gates /v1/models behind team credits — common on fresh
            // accounts. fetchXaiModels already swallows this and falls back
            // to a static list, so reaching here means a different provider
            // returned 403 (rare).
            return 'Forbidden (403). The account may lack permission or credits — check the provider console.';
        }
        if (status === '400') {
            // xAI uses 400 for invalid key; most other providers use 400 for
            // malformed requests. Either way the user can't fix it without
            // checking the key first.
            return 'Bad request (400). The API key may be invalid — check it in the provider console.';
        }
        if (status === '429') {
            return 'Rate limit hit. Try again in a minute.';
        }
        if (status === '404') {
            return 'Endpoint not found (404). Check the base URL setting.';
        }
        return err.message;
    }

    private async fetchByProvider(provider: Provider): Promise<string[]> {
        switch (provider) {
            case 'gemini': {
                const key = await ApiKeyManager.getOptionalKey('gemini');
                if (!key) {
                    throw new Error('Gemini API key is not set');
                }
                return fetchGeminiModels(key);
            }
            case 'openai': {
                const key = await ApiKeyManager.getOptionalKey('openai');
                if (!key) {
                    throw new Error('OpenAI API key is not set');
                }
                return fetchOpenAIModels(key, ConfigService.get('openai.baseUrl'));
            }
            case 'codestral': {
                const key = await ApiKeyManager.getOptionalKey('codestral');
                if (!key) {
                    throw new Error('Codestral API key is not set');
                }
                return fetchCodestralModels(key);
            }
            case 'ollama': {
                const useAuth = ConfigService.get('ollama.useAuthToken');
                const token = useAuth ? await ApiKeyManager.getOptionalKey('ollama') : undefined;
                return fetchOllamaModels(ConfigService.get('ollama.baseUrl'), token);
            }
            case 'openrouter': {
                const key = await ApiKeyManager.getOptionalKey('openrouter');
                if (!key) {
                    throw new Error('OpenRouter API key is not set');
                }
                return fetchOpenRouterModels(key, ConfigService.get('openrouter.preferFreeModels'));
            }
            case 'groq': {
                const key = await ApiKeyManager.getOptionalKey('groq');
                if (!key) {
                    throw new Error('Groq API key is not set');
                }
                return fetchGroqModels(key);
            }
            case 'anthropic': {
                // Anthropic has no public /models endpoint; the list is a
                // static fallback baked into modelLists.ts. We still gate on
                // the key being set so the UI surfaces the same "set a key"
                // hint as the other providers.
                const key = await ApiKeyManager.getOptionalKey('anthropic');
                if (!key) {
                    throw new Error('Anthropic API key is not set');
                }
                return fetchAnthropicModels(key);
            }
            case 'deepseek': {
                const key = await ApiKeyManager.getOptionalKey('deepseek');
                if (!key) {
                    throw new Error('DeepSeek API key is not set');
                }
                return fetchDeepSeekModels(key);
            }
            case 'xai': {
                const key = await ApiKeyManager.getOptionalKey('xai');
                if (!key) {
                    throw new Error('xAI API key is not set');
                }
                return fetchXaiModels(key);
            }
            case 'custom': {
                // Custom has no listing endpoint — user types the model
                // manually. Returning an empty list lets the dropdown render
                // just the currently configured model.
                return [];
            }
        }
    }

    private async buildState(): Promise<ViewState> {
        const [
            geminiKey, openaiKey, codestralKey, ollamaToken,
            openrouterKey, groqKey, anthropicKey, deepseekKey, xaiKey, customKey,
        ] = await Promise.all([
            ApiKeyManager.getOptionalKey('gemini'),
            ApiKeyManager.getOptionalKey('openai'),
            ApiKeyManager.getOptionalKey('codestral'),
            ApiKeyManager.getOptionalKey('ollama'),
            ApiKeyManager.getOptionalKey('openrouter'),
            ApiKeyManager.getOptionalKey('groq'),
            ApiKeyManager.getOptionalKey('anthropic'),
            ApiKeyManager.getOptionalKey('deepseek'),
            ApiKeyManager.getOptionalKey('xai'),
            ApiKeyManager.getOptionalKey('custom'),
        ]);

        return {
            trusted: vscode.workspace.isTrusted,
            projectOverrides: (Object.keys(SETTING_KEYS) as (keyof typeof SETTING_KEYS)[])
                .filter(name => ConfigService.isProjectOverridden(SETTING_KEYS[name].replace(/^commitSage\./, ''))),
            provider: ConfigService.get('provider.type') as Provider,
            models: this.models,
            selected: {
                gemini: ConfigService.get('gemini.model'),
                openai: ConfigService.get('openai.model'),
                codestral: ConfigService.get('codestral.model'),
                ollama: ConfigService.get('ollama.model'),
                openrouter: ConfigService.get('openrouter.model'),
                groq: ConfigService.get('groq.model'),
                anthropic: ConfigService.get('anthropic.model'),
                deepseek: ConfigService.get('deepseek.model'),
                xai: ConfigService.get('xai.model'),
                custom: ConfigService.get('custom.model'),
            },
            hasApiKey: {
                gemini: !!geminiKey,
                openai: !!openaiKey,
                codestral: !!codestralKey,
                ollama: !!ollamaToken,
                openrouter: !!openrouterKey,
                groq: !!groqKey,
                anthropic: !!anthropicKey,
                deepseek: !!deepseekKey,
                xai: !!xaiKey,
                custom: !!customKey,
            },
            openai: { baseUrl: ConfigService.get('openai.baseUrl') },
            ollama: {
                baseUrl: ConfigService.get('ollama.baseUrl'),
                useAuthToken: ConfigService.get('ollama.useAuthToken'),
                numCtx: ConfigService.get('ollama.numCtx'),
            },
            openrouter: {
                preferFreeModels: ConfigService.get('openrouter.preferFreeModels'),
            },
            custom: {
                baseUrl: ConfigService.get('custom.baseUrl'),
                useApiKey: ConfigService.get('custom.useApiKey'),
                chatCompletionsPath: ConfigService.get('custom.chatCompletionsPath'),
            },
            commit: {
                format: ConfigService.get('commit.commitFormat'),
                language: ConfigService.get('commit.commitLanguage'),
                customLanguageName: ConfigService.get('commit.customLanguageName'),
                promptForRefs: ConfigService.get('commit.promptForRefs'),
                onlyStagedChanges: ConfigService.get('commit.onlyStagedChanges'),
                autoCommit: ConfigService.get('commit.autoCommit'),
                autoPush: ConfigService.get('commit.autoPush'),
                useCustomInstructions: ConfigService.get('commit.useCustomInstructions'),
                customInstructions: ConfigService.get('commit.customInstructions'),
                commitlintEnabled: ConfigService.get('commit.commitlint.enabled'),
                commitlintMaxRetries: ConfigService.get('commit.commitlint.maxRetries'),
                commitlintRulesPath: ConfigService.get('commit.commitlint.rulesPath'),
                commitlintEngine: ConfigService.get('commit.commitlint.engine'),
                commitlintCliAvailable: (() => {
                    const root = ConfigService.getProjectRootPath();
                    return root ? CommitLintCliService.detect(root) !== null : false;
                })(),
            },
            advanced: {
                apiRequestTimeout: ConfigService.get('apiRequestTimeout'),
                gitTimeout: ConfigService.get('gitTimeout'),
                maxDiffSize: ConfigService.get('general.maxDiffSize'),
                temperature: ConfigService.get('general.temperature'),
                telemetryEnabled: ConfigService.get('telemetry.enabled'),
            },
        };
    }

    private async pushState(): Promise<void> {
        if (!this.view) {
            return;
        }
        const state = await this.buildState();
        await this.view.webview.postMessage({ type: 'state', state });
    }

    private renderHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.js'),
        );
        const cspSource = webview.cspSource;

        const styles = `
            :root { color-scheme: light dark; }
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                padding: 10px 12px;
                margin: 0;
            }
            details {
                margin-bottom: 12px;
                border: 1px solid var(--vscode-panel-border, transparent);
                border-radius: 3px;
            }
            details > summary {
                cursor: pointer;
                padding: 6px 8px;
                font-weight: 600;
                user-select: none;
                outline: none;
            }
            details[open] > summary { border-bottom: 1px solid var(--vscode-panel-border, transparent); }
            .body { padding: 8px 10px 10px; }
            section.provider-pick { margin-bottom: 12px; }
            label.field {
                display: block;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                color: var(--vscode-descriptionForeground);
                margin: 8px 0 3px;
            }
            label.field:first-child { margin-top: 0; }
            select, input[type="text"], input[type="number"], textarea {
                width: 100%;
                padding: 4px 6px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border, transparent);
                border-radius: 2px;
                box-sizing: border-box;
                font-family: inherit;
                font-size: inherit;
            }
            textarea { resize: vertical; min-height: 60px; font-family: var(--vscode-editor-font-family, monospace); }
            select:focus, input:focus, textarea:focus {
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: -1px;
            }
            .row { display: flex; gap: 6px; align-items: stretch; }
            .row > select, .row > input { flex: 1; }
            button {
                padding: 4px 10px;
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-family: inherit;
                font-size: inherit;
            }
            button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
            button.primary {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
            button#refresh-models {
                font-size: 20px;
                line-height: 1;
                padding: 2px 10px;
            }
            button:disabled, input:disabled, select:disabled, textarea:disabled {
                opacity: 0.5;
                cursor: default;
            }
            .actions { display: flex; gap: 6px; align-items: center; margin-top: 4px; flex-wrap: wrap; }
            .checkbox-row {
                display: flex;
                gap: 6px;
                align-items: center;
                margin: 6px 0;
            }
            .checkbox-row input { width: auto; }
            .checkbox-row label { color: var(--vscode-foreground); cursor: pointer; }
            .checkbox-row.disabled label { opacity: 0.6; cursor: default; }
            .hint {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                margin-top: 4px;
            }
            .hint.pinned {
                color: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground, #cca700));
                font-weight: 600;
            }
            .error {
                font-size: 11px;
                color: var(--vscode-errorForeground);
                margin-top: 4px;
                word-break: break-word;
            }
            .badge {
                font-size: 10px;
                color: var(--vscode-descriptionForeground);
            }
            .badge.on { color: var(--vscode-testing-iconPassed, var(--vscode-charts-green, currentColor)); }
            .combo {
                position: relative;
                flex: 1;
            }
            .combo > input {
                width: 100%;
                box-sizing: border-box;
            }
            .combo-list {
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                max-height: 280px;
                overflow-y: auto;
                margin: 2px 0 0;
                padding: 0;
                list-style: none;
                background: var(--vscode-dropdown-background, var(--vscode-input-background));
                color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
                border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
                border-radius: 2px;
                z-index: 10;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            }
            .combo-list[hidden] { display: none; }
            .combo-list-item {
                padding: 4px 8px;
                cursor: pointer;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-family: inherit;
                font-size: inherit;
            }
            .combo-list-item.active,
            .combo-list-item:hover {
                background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
                color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
            }
        `;

        const data = {
            providers: PROVIDERS,
            languages: LANGUAGES,
            formats: FORMATS,
            settingKeys: SETTING_KEYS,
            apiKeyUrls: API_KEY_URLS,
            l10n: {
                provider: vscode.l10n.t('Provider'),
                modelAuth: vscode.l10n.t('Model & authentication'),
                model: vscode.l10n.t('Model'),
                modelPlaceholder: vscode.l10n.t('Type a model ID'),
                refresh: vscode.l10n.t('Refresh'),
                refreshing: vscode.l10n.t('Refreshing…'),
                baseUrl: vscode.l10n.t('Base URL'),
                path: vscode.l10n.t('Path'),
                apiKey: vscode.l10n.t('API key'),
                authToken: vscode.l10n.t('Auth token'),
                setKey: vscode.l10n.t('Set'),
                removeKey: vscode.l10n.t('Remove'),
                getKey: vscode.l10n.t('Get key ↗'),
                keySet: vscode.l10n.t('● set'),
                keyMissing: vscode.l10n.t('○ not set'),
                noKey: vscode.l10n.t('Set an API key to load the live model list.'),
                useAuthToken: vscode.l10n.t('Use auth token'),
                useApiKey: vscode.l10n.t('Send API key'),
                preferFreeModels: vscode.l10n.t('Show free models only'),
                liveFrom: vscode.l10n.t('Live list from'),
                notInList: vscode.l10n.t('(not in live list)'),
                commit: vscode.l10n.t('Commit message'),
                format: vscode.l10n.t('Format'),
                language: vscode.l10n.t('Language'),
                customLanguage: vscode.l10n.t('Custom language name'),
                promptForRefs: vscode.l10n.t('Prompt for refs'),
                onlyStaged: vscode.l10n.t('Only staged changes'),
                automation: vscode.l10n.t('Automation'),
                autoCommit: vscode.l10n.t('Auto-commit'),
                autoPush: vscode.l10n.t('Auto-push'),
                autoPushNeedsCommit: vscode.l10n.t('Requires auto-commit'),
                untrusted: vscode.l10n.t('Disabled in untrusted workspaces'),
                customInstructions: vscode.l10n.t('Custom instructions'),
                commitlintEnabled: vscode.l10n.t('Validate & retry generated message'),
                commitlintEngine: vscode.l10n.t('Validator'),
                commitlintMaxRetries: vscode.l10n.t('Max commitlint retries'),
                commitlintRulesPath: vscode.l10n.t('Commitlint rules path'),
                enableCustom: vscode.l10n.t('Enable custom instructions'),
                customInstructionsPh: vscode.l10n.t('Free-form text appended to the prompt — e.g. ticket-tag conventions.'),
                advanced: vscode.l10n.t('Advanced'),
                apiTimeout: vscode.l10n.t('API request timeout (seconds)'),
                gitTimeout: vscode.l10n.t('Git timeout (seconds)'),
                timeoutHint: vscode.l10n.t('-1 disables the timeout'),
                maxDiffSize: vscode.l10n.t('Max diff size (characters)'),
                maxDiffSizeHint: vscode.l10n.t('-1 disables truncation. For Groq free tier set ~20000. Default 100000 ≈ 25000 tokens.'),
                temperature: vscode.l10n.t('Temperature'),
                temperatureHint: vscode.l10n.t('LLM sampling temperature. 0 = deterministic, 0.7 = default, 1+ = more varied.'),
                ollamaNumCtx: vscode.l10n.t('Context window (num_ctx)'),
                ollamaNumCtxHint: vscode.l10n.t('Ollama context length. 0 = use model default. Larger values use more RAM/VRAM.'),
                telemetry: vscode.l10n.t('Telemetry'),
                autoOption: vscode.l10n.t('auto — try all available models'),
                providerLabels: {
                    gemini: 'Gemini',
                    openai: 'OpenAI',
                    codestral: 'Codestral',
                    ollama: 'Ollama',
                    openrouter: 'OpenRouter',
                    groq: 'Groq',
                    anthropic: 'Anthropic Claude',
                    deepseek: 'DeepSeek',
                    xai: 'xAI Grok',
                    custom: 'Custom (OpenAI-compatible)',
                },
                liveSource: {
                    gemini: 'Google Generative Language',
                    openai: 'OpenAI /v1/models (gpt-* / o-series)',
                    codestral: 'Mistral published Codestral aliases (static — no list API)',
                    ollama: '/api/tags (local)',
                    openrouter: 'OpenRouter /api/v1/models',
                    groq: 'Groq /openai/v1/models',
                    anthropic: 'Static list (Anthropic has no public /models endpoint)',
                    deepseek: 'DeepSeek /models',
                    xai: 'xAI /v1/models',
                    custom: 'Free-form — type the model your endpoint exposes',
                },
            },
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${cspSource}; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
    <style>${styles}</style>
    <title>Commit Sage</title>
</head>
<body>
    <div id="root"></div>
    <script id="init-data" type="application/json">${escapeForScript(JSON.stringify(data))}</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let s = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
}

function escapeForScript(s: string): string {
    // </script> in JSON would break out of the <script> block. The other two
    // pairs neutralise HTML comment / CDATA endings just in case.
    return s.replace(/<\/script>/gi, '<\\/script>').replace(/<!--/g, '<\\!--').replace(/]]>/g, ']]\\>');
}
