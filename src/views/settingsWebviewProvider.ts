import * as vscode from 'vscode';
import { ConfigService, SETTING_DEFAULTS, SettingKey } from '../utils/configService';
import { CommitLintCliService } from '../services/commitLintCliService';
import { ApiKeyManager } from '../services/apiKeyManager';
import {
    PROVIDERS,
    NO_REFRESH_PROVIDERS,
    SECRET_KEYS,
    API_KEY_URLS,
    PROVIDER_LABELS,
    providerDef,
} from '../services/providerRegistry';
import { handleHttpError } from '../services/baseAIService';
import { HttpError } from '../utils/httpUtils';
import {
    Provider,
    ModelSlot,
    ViewState,
    IncomingMessage,
    InitData,
    WebviewSettingKey,
    WebviewSettings,
} from './webview/protocol';
import { buildWebviewL10n } from './webviewL10n';
import { renderSettingsHtml } from './settingsHtml';
import { GitService } from '../services/gitService';
import { RefStore } from '../services/refStore';
import { Logger } from '../utils/logger';
import { toError } from '../utils/errorUtils';
import { getNonce } from '../utils/nonce';

const VIEW_ID = 'commitsage.settings';

// Every setting the panel reads and may write (see WebviewSettingKey).
const WEBVIEW_SETTING_KEYS = (Object.keys(SETTING_DEFAULTS) as SettingKey[])
    .filter((k): k is WebviewSettingKey => k !== 'telemetry.enabled');

export class SettingsWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = VIEW_ID;

    private view: vscode.WebviewView | undefined;
    private readonly models = Object.fromEntries(
        PROVIDERS.map((p): [Provider, ModelSlot] => [p, { list: [], loading: false, error: null }]),
    ) as Record<Provider, ModelSlot>;
    // Latest refresh per provider; a forced refresh can overlap an older one.
    private readonly refreshGen: Partial<Record<Provider, number>> = {};

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

        // Disposed with the view, so a re-resolved view doesn't stack listeners.
        const subs = [
            webviewView.webview.onDidReceiveMessage((msg: IncomingMessage) => void this.handleMessage(msg)),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (!e.affectsConfiguration('commitSage')) {
                    return;
                }
                void this.pushState();
                // A cached list goes stale when the endpoint or the free-only
                // filter changes; a newly picked provider needs its first load.
                const provider = ConfigService.getProvider();
                const force = e.affectsConfiguration(`commitSage.${provider}.baseUrl`)
                    || (provider === 'openrouter' && e.affectsConfiguration('commitSage.openrouter.preferFreeModels'));
                if (force || e.affectsConfiguration('commitSage.provider.type')) {
                    void this.refreshModelsFor(provider, force);
                }
            }),
            // Secret changes (Set/Remove key buttons) don't fire onDidChangeConfiguration,
            // so the "● set" indicator drifts unless we also listen to SecretStorage.
            this.context.secrets.onDidChange(e => {
                if (SECRET_KEYS.includes(e.key)) {
                    void this.pushState();
                }
            }),
            webviewView.onDidChangeVisibility(() => {
                if (webviewView.visible) {
                    void this.pushState();
                }
            }),
            // Edits to .commitsage/config.json fire no settings event; values and pins would go stale.
            ConfigService.onProjectConfigChange(() => void this.pushState()),
        ];
        webviewView.onDidDispose(() => {
            if (this.view === webviewView) {
                this.view = undefined;
            }
            subs.forEach(d => d.dispose());
        });
    }

    private async handleMessage(msg: IncomingMessage): Promise<void> {
        try {
            switch (msg.type) {
                case 'getState':
                    await this.pushState();
                    // Lazy live fetch for the current provider on first open so
                    // the dropdown isn't empty.
                    await this.refreshModelsFor(ConfigService.getProvider(), false);
                    return;

                case 'setSetting':
                    // Key and value come from the webview: accept only the
                    // panel's own settings, with the type of their default.
                    if (WEBVIEW_SETTING_KEYS.includes(msg.key)
                        && typeof msg.value === typeof SETTING_DEFAULTS[msg.key]) {
                        await ConfigService.set(msg.key, msg.value);
                    }
                    return;

                case 'saveRefForBranch': {
                    const branch = await this.currentBranch();
                    if (!branch) {
                        void Logger.showError(vscode.l10n.t('No git branch detected — cannot save a branch ref.'));
                        return;
                    }
                    await RefStore.setBranchRef(branch, msg.value);
                    await this.pushState();
                    return;
                }

                case 'saveRefForProject':
                    await ConfigService.setProjectConfigValue('commit.refs.value', msg.value.trim());
                    await this.pushState();
                    return;

                case 'clearBranchRef': {
                    const branch = await this.currentBranch();
                    if (branch) {
                        await RefStore.clearBranchRef(branch);
                    }
                    await this.pushState();
                    return;
                }

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

        const gen = (this.refreshGen[provider] ?? 0) + 1;
        this.refreshGen[provider] = gen;
        slot.loading = true;
        slot.error = null;

        try {
            await this.pushState();
            const list = await providerDef(provider).fetchModels();
            if (gen !== this.refreshGen[provider]) {
                return;
            }
            slot.list = list;
            slot.error = null;
        } catch (error) {
            const err = toError(error);
            if (gen !== this.refreshGen[provider]) {
                return;
            }
            // Same wording as a failed generation; a 404 here almost always
            // means a wrong base URL rather than a missing model.
            slot.error = err instanceof HttpError && err.status === 404
                ? vscode.l10n.t('Endpoint not found (404). Check the base URL setting.')
                : handleHttpError(err, PROVIDER_LABELS[provider]).errorMessage;
            Logger.error(`Model refresh failed for ${provider}:`, err);
        } finally {
            if (gen === this.refreshGen[provider]) {
                slot.loading = false;
                await this.pushState();
            }
        }
    }

    private async buildState(): Promise<ViewState> {
        const hasApiKeyEntries = await Promise.all(
            PROVIDERS.map(async p => [p, !!(await ApiKeyManager.getOptionalKey(p))] as const),
        );

        // Branch + its saved ref are only needed for the "save for branch" UI,
        // which shows under the 'input' source — skip the git call otherwise.
        const refsNeedBranch = ConfigService.get('commit.refs.enabled')
            && ConfigService.get('commit.refs.source') === 'input';
        const refsBranch = refsNeedBranch ? await this.currentBranch() : '';
        const refsBranchRef = refsBranch ? (RefStore.getBranchRef(refsBranch) ?? '') : '';
        // detect() walks the filesystem up to its root on every push; the engine
        // picker it feeds shows only while commitlint is enabled.
        const commitlintRoot = ConfigService.get('commit.commitlint.enabled')
            ? ConfigService.getProjectRootPath()
            : undefined;

        return {
            trusted: vscode.workspace.isTrusted,
            projectOverrides: WEBVIEW_SETTING_KEYS.filter(k => ConfigService.isProjectOverridden(k)),
            provider: ConfigService.getProvider(),
            settings: Object.fromEntries(
                WEBVIEW_SETTING_KEYS.map(k => [k, ConfigService.get(k)]),
            ) as WebviewSettings,
            models: this.models,
            hasApiKey: Object.fromEntries(hasApiKeyEntries) as Record<Provider, boolean>,
            refsBranch,
            refsBranchRef,
            commitlintCliAvailable: !!commitlintRoot && CommitLintCliService.detect(commitlintRoot) !== null,
        };
    }

    private async currentBranch(): Promise<string> {
        const root = ConfigService.getProjectRootPath();
        return root ? GitService.getBranchName(root) : '';
    }

    private async pushState(): Promise<void> {
        // Captured: onDidDispose may clear this.view while buildState awaits.
        const view = this.view;
        if (!view) {
            return;
        }
        const state = await this.buildState();
        await view.webview.postMessage({ type: 'state', state });
    }

    private renderHtml(webview: vscode.Webview): string {
        const initData: InitData = {
            providers: PROVIDERS,
            noRefreshProviders: NO_REFRESH_PROVIDERS,
            apiKeyUrls: API_KEY_URLS,
            l10n: buildWebviewL10n(),
        };

        return renderSettingsHtml({
            scriptUri: webview.asWebviewUri(
                vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.js'),
            ).toString(),
            styleUri: webview.asWebviewUri(
                vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'styles.css'),
            ).toString(),
            cspSource: webview.cspSource,
            nonce: getNonce(),
            initData,
            loadingLabel: vscode.l10n.t('Loading…'),
        });
    }
}
