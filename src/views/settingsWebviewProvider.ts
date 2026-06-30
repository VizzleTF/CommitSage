import * as vscode from 'vscode';
import { ConfigService, SETTING_DEFAULTS } from '../utils/configService';
import { CommitLintCliService } from '../services/commitLintCliService';
import { ApiKeyManager } from '../services/apiKeyManager';
import { COMMITLINT_COMPATIBLE_FORMATS } from '../services/formatRules';
import {
    PROVIDERS,
    NO_REFRESH_PROVIDERS,
    SECRET_KEYS,
    API_KEY_URLS,
    providerDef,
} from '../services/providerRegistry';
import {
    Provider,
    ModelSlot,
    ViewState,
    IncomingMessage,
    InitData,
} from './webview/protocol';
import { buildWebviewL10n } from './webviewL10n';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';
import { getNonce } from '../utils/nonce';

const VIEW_ID = 'commitsage.settings';

const LANGUAGES = [
    'english', 'russian', 'chinese', 'japanese', 'korean',
    'german', 'french', 'spanish', 'portuguese', 'custom',
] as const;
const FORMATS = [
    'conventional', 'angular', 'karma', 'semantic',
    'emoji', 'emojiKarma', 'google', 'atom', 'detailed', 'custom',
] as const;

// Webview camelCase alias -> dotted setting path (no `commitSage.` prefix).
// `satisfies Record<string, keyof typeof SETTING_DEFAULTS>` makes any drift
// from the real setting schema in configService a compile error, so these
// can't silently diverge from SETTING_DEFAULTS the way two hand-kept lists do.
const SETTING_PATHS = {
    provider: 'provider.type',
    geminiModel: 'gemini.model',
    codestralModel: 'codestral.model',
    openaiModel: 'openai.model',
    openaiBaseUrl: 'openai.baseUrl',
    ollamaModel: 'ollama.model',
    ollamaBaseUrl: 'ollama.baseUrl',
    ollamaUseAuthToken: 'ollama.useAuthToken',
    openrouterModel: 'openrouter.model',
    openrouterPreferFreeModels: 'openrouter.preferFreeModels',
    groqModel: 'groq.model',
    anthropicModel: 'anthropic.model',
    deepseekModel: 'deepseek.model',
    xaiModel: 'xai.model',
    customBaseUrl: 'custom.baseUrl',
    customModel: 'custom.model',
    customUseApiKey: 'custom.useApiKey',
    customChatCompletionsPath: 'custom.chatCompletionsPath',
    maxDiffSize: 'general.maxDiffSize',
    temperature: 'general.temperature',
    ollamaNumCtx: 'ollama.numCtx',
    commitLanguage: 'commit.commitLanguage',
    customLanguageName: 'commit.customLanguageName',
    commitFormat: 'commit.commitFormat',
    promptForRefs: 'commit.promptForRefs',
    onlyStagedChanges: 'commit.onlyStagedChanges',
    autoCommit: 'commit.autoCommit',
    autoPush: 'commit.autoPush',
    useCustomInstructions: 'commit.useCustomInstructions',
    customInstructions: 'commit.customInstructions',
    apiRequestTimeout: 'apiRequestTimeout',
    gitTimeout: 'gitTimeout',
    telemetryEnabled: 'telemetry.enabled',
    commitlintEnabled: 'commit.commitlint.enabled',
    commitlintMaxRetries: 'commit.commitlint.maxRetries',
    commitlintRulesPath: 'commit.commitlint.rulesPath',
    commitlintEngine: 'commit.commitlint.engine',
} as const satisfies Record<string, keyof typeof SETTING_DEFAULTS>;

const SETTING_KEYS = Object.fromEntries(
    Object.entries(SETTING_PATHS).map(([alias, path]) => [alias, `commitSage.${path}`]),
) as { [K in keyof typeof SETTING_PATHS]: `commitSage.${(typeof SETTING_PATHS)[K]}` };

export class SettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = VIEW_ID;

    private view: vscode.WebviewView | undefined;
    private readonly models = Object.fromEntries(
        PROVIDERS.map((p): [Provider, ModelSlot] => [p, { list: [], loading: false, error: null }]),
    ) as Record<Provider, ModelSlot>;

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
            if (SECRET_KEYS.includes(e.key)) {
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
                    await vscode.commands.executeCommand(providerDef(msg.provider).setCmd);
                    await this.refreshModelsFor(msg.provider, true);
                    return;

                case 'removeApiKey':
                    await vscode.commands.executeCommand(providerDef(msg.provider).removeCmd);
                    return;

                case 'loginOpenRouter':
                    // OAuth PKCE flow; on success it stores the key in SecretStorage,
                    // which the secret-change listener picks up to refresh the badge.
                    await vscode.commands.executeCommand('commitsage.loginOpenRouter');
                    await this.refreshModelsFor('openrouter', true);
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
            slot.list = await providerDef(provider).fetchModels();
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
        const httpMatch = /^HTTP (\d{3})$/.exec(err.message);
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

    private async buildState(): Promise<ViewState> {
        const hasApiKeyEntries = await Promise.all(
            PROVIDERS.map(async p => [p, !!(await ApiKeyManager.getOptionalKey(p))] as const),
        );

        return {
            trusted: vscode.workspace.isTrusted,
            projectOverrides: (Object.keys(SETTING_PATHS) as (keyof typeof SETTING_PATHS)[])
                .filter(name => ConfigService.isProjectOverridden(SETTING_PATHS[name])),
            provider: ConfigService.get('provider.type') as Provider,
            models: this.models,
            selected: Object.fromEntries(
                PROVIDERS.map(p => [p, providerDef(p).selectedModel()]),
            ) as Record<Provider, string>,
            hasApiKey: Object.fromEntries(hasApiKeyEntries) as Record<Provider, boolean>,
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
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'styles.css'),
        );

        const data: InitData = {
            providers: PROVIDERS,
            languages: LANGUAGES,
            formats: FORMATS,
            commitlintCompatFormats: [...COMMITLINT_COMPATIBLE_FORMATS],
            noRefreshProviders: NO_REFRESH_PROVIDERS,
            settingKeys: SETTING_KEYS,
            apiKeyUrls: API_KEY_URLS,
            l10n: buildWebviewL10n(),
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
    <link rel="stylesheet" href="${styleUri}">
    <title>Commit Sage</title>
</head>
<body>
    <div id="root"><div class="loading">${escapeHtml(vscode.l10n.t('Loading…'))}</div></div>
    <script id="init-data" type="application/json">${escapeForScript(JSON.stringify(data))}</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function escapeHtml(s: string): string {
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function escapeForScript(s: string): string {
    // </script> in JSON would break out of the <script> block. The other two
    // pairs neutralise HTML comment / CDATA endings just in case.
    return s
        .replaceAll(/<\/script>/gi, String.raw`<\/script>`)
        .replaceAll('<!--', String.raw`<\!--`)
        .replaceAll(']]>', String.raw`]]\>`);
}
