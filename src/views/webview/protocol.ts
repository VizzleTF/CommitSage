// Shared message + state contract between the extension host
// (settingsWebviewProvider.ts) and the webview frontend (webview/main.ts).
//
// TYPES ONLY — no runtime code, and host modules are pulled in with
// `import type` only (esbuild erases those), so the browser bundle can import
// this file without Node deps and both sides stay in lock-step.

import type { SettingKey, SettingValue } from '../../utils/configService';
import type { buildWebviewL10n } from '../webviewL10n';

export type Provider =
    | 'gemini'
    | 'codestral'
    | 'mistral'
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
export type WebviewL10n = ReturnType<typeof buildWebviewL10n>;

/**
 * Settings the panel reads and writes, keyed like `ConfigService.get`.
 * `telemetry.enabled` has no control here, and the webview must not be able to
 * turn telemetry back on, so it stays out of the contract.
 */
export type WebviewSettingKey = Exclude<SettingKey, 'telemetry.enabled'>;
export type WebviewSettings = { [K in WebviewSettingKey]: SettingValue<K> };

/** One-shot payload embedded in the page; never changes after first render. */
export interface InitData {
    providers: readonly Provider[];
    /** Providers with no live model endpoint — UI hides their refresh button. */
    noRefreshProviders: readonly Provider[];
    apiKeyUrls: Partial<Record<Provider, string>>;
    l10n: WebviewL10n;
}

/** Live, re-pushed-on-change snapshot the webview renders from. */
export interface ViewState {
    trusted: boolean;
    /** Keys pinned by .commitsage/config.json — their controls are inert. */
    projectOverrides: WebviewSettingKey[];
    /** Provider generation uses: an invalid `provider.type` falls back to gemini. */
    provider: Provider;
    /** Effective value of every panel setting (project config included). */
    settings: WebviewSettings;
    models: Record<Provider, ModelSlot>;
    hasApiKey: Record<Provider, boolean>;
    /** Current git branch ('' when unavailable) — labels the save button. */
    refsBranch: string;
    /** Ref saved for the current branch in workspaceState ('' when none). */
    refsBranchRef: string;
    commitlintCliAvailable: boolean;
}

/** Messages the webview posts up to the extension host. */
export type IncomingMessage =
    | { type: 'getState' }
    | { type: 'setSetting'; key: WebviewSettingKey; value: string | boolean | number }
    | { type: 'saveRefForBranch'; value: string }
    | { type: 'saveRefForProject'; value: string }
    | { type: 'clearBranchRef' }
    | { type: 'refreshModels'; provider: Provider }
    | { type: 'setApiKey'; provider: Provider }
    | { type: 'removeApiKey'; provider: Provider }
    | { type: 'loginOpenRouter' }
    | { type: 'openExternal'; url: string };
