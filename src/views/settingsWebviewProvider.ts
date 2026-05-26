import * as vscode from 'vscode';
import { ConfigService } from '../utils/configService';
import { ApiKeyManager } from '../services/apiKeyManager';
import {
    fetchGeminiModels,
    fetchOpenAIModels,
    fetchCodestralModels,
    fetchOllamaModels,
} from '../services/modelLists';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';

const VIEW_ID = 'commitsage.settings';

type Provider = 'gemini' | 'codestral' | 'openai' | 'ollama';
const PROVIDERS: readonly Provider[] = ['gemini', 'codestral', 'openai', 'ollama'] as const;

const LANGUAGES = [
    'english', 'russian', 'chinese', 'japanese', 'korean',
    'german', 'french', 'spanish', 'portuguese', 'custom',
] as const;
const FORMATS = [
    'conventional', 'angular', 'karma', 'semantic',
    'emoji', 'emojiKarma', 'google', 'atom', 'custom',
] as const;

const SECRET_KEYS: Record<Provider, string> = {
    gemini: 'commitsage.apiKey',
    openai: 'commitsage.openaiApiKey',
    codestral: 'commitsage.codestralApiKey',
    ollama: 'commitsage.ollamaAuthToken',
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
} as const;

interface ModelSlot {
    list: string[];
    loading: boolean;
    error: string | null;
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

type IncomingMessage =
    | { type: 'getState' }
    | { type: 'setSetting'; key: string; value: string | boolean | number }
    | { type: 'refreshModels'; provider: Provider }
    | { type: 'setApiKey'; provider: Provider }
    | { type: 'removeApiKey'; provider: Provider };

const SET_KEY_COMMAND: Record<Provider, string> = {
    gemini: 'commitsage.setApiKey',
    openai: 'commitsage.setOpenAIApiKey',
    codestral: 'commitsage.setCodestralApiKey',
    ollama: 'commitsage.setOllamaAuthToken',
};
const REMOVE_KEY_COMMAND: Record<Provider, string> = {
    gemini: 'commitsage.removeApiKey',
    openai: 'commitsage.removeOpenAIApiKey',
    codestral: 'commitsage.removeCodestralApiKey',
    ollama: 'commitsage.removeOllamaAuthToken',
};

export class SettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = VIEW_ID;

    private view: vscode.WebviewView | undefined;
    private models: Record<Provider, ModelSlot> = {
        gemini: { list: [], loading: false, error: null },
        openai: { list: [], loading: false, error: null },
        codestral: { list: [], loading: false, error: null },
        ollama: { list: [], loading: false, error: null },
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
            slot.error = err.message;
            Logger.error(`Model refresh failed for ${provider}:`, err);
        } finally {
            slot.loading = false;
            await this.pushState();
        }
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
        }
    }

    private async buildState(): Promise<ViewState> {
        const [geminiKey, openaiKey, codestralKey, ollamaToken] = await Promise.all([
            ApiKeyManager.getOptionalKey('gemini'),
            ApiKeyManager.getOptionalKey('openai'),
            ApiKeyManager.getOptionalKey('codestral'),
            ApiKeyManager.getOptionalKey('ollama'),
        ]);

        return {
            trusted: vscode.workspace.isTrusted,
            provider: ConfigService.get('provider.type') as Provider,
            models: this.models,
            selected: {
                gemini: ConfigService.get('gemini.model'),
                openai: ConfigService.get('openai.model'),
                codestral: ConfigService.get('codestral.model'),
                ollama: ConfigService.get('ollama.model'),
            },
            hasApiKey: {
                gemini: !!geminiKey,
                openai: !!openaiKey,
                codestral: !!codestralKey,
                ollama: !!ollamaToken,
            },
            openai: { baseUrl: ConfigService.get('openai.baseUrl') },
            ollama: {
                baseUrl: ConfigService.get('ollama.baseUrl'),
                useAuthToken: ConfigService.get('ollama.useAuthToken'),
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
            },
            advanced: {
                apiRequestTimeout: ConfigService.get('apiRequestTimeout'),
                gitTimeout: ConfigService.get('gitTimeout'),
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
        `;

        const data = {
            providers: PROVIDERS,
            languages: LANGUAGES,
            formats: FORMATS,
            settingKeys: SETTING_KEYS,
            l10n: {
                provider: vscode.l10n.t('Provider'),
                modelAuth: vscode.l10n.t('Model & authentication'),
                model: vscode.l10n.t('Model'),
                refresh: vscode.l10n.t('Refresh'),
                refreshing: vscode.l10n.t('Refreshing…'),
                baseUrl: vscode.l10n.t('Base URL'),
                apiKey: vscode.l10n.t('API key'),
                authToken: vscode.l10n.t('Auth token'),
                setKey: vscode.l10n.t('Set'),
                removeKey: vscode.l10n.t('Remove'),
                keySet: vscode.l10n.t('● set'),
                keyMissing: vscode.l10n.t('○ not set'),
                noKey: vscode.l10n.t('Set an API key to load the live model list.'),
                useAuthToken: vscode.l10n.t('Use auth token'),
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
                enableCustom: vscode.l10n.t('Enable custom instructions'),
                customInstructionsPh: vscode.l10n.t('Free-form text appended to the prompt — e.g. ticket-tag conventions.'),
                advanced: vscode.l10n.t('Advanced'),
                apiTimeout: vscode.l10n.t('API request timeout (seconds)'),
                gitTimeout: vscode.l10n.t('Git timeout (seconds)'),
                timeoutHint: vscode.l10n.t('-1 disables the timeout'),
                telemetry: vscode.l10n.t('Telemetry'),
                autoOption: vscode.l10n.t('auto — try all available models'),
                providerLabels: {
                    gemini: 'Gemini',
                    openai: 'OpenAI',
                    codestral: 'Codestral',
                    ollama: 'Ollama',
                },
                liveSource: {
                    gemini: 'Google Generative Language',
                    openai: 'OpenAI /v1/models (gpt-* / o-series)',
                    codestral: 'Mistral published Codestral aliases (static — no list API)',
                    ollama: '/api/tags (local)',
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
