import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Logger } from './logger';
import { ProjectConfig } from '../models/types';
import { toError } from './errorUtils';
import { isProvider } from '../services/providerCatalog';
import { statOrUndefined } from './fsUtils';
import { isPlainObject, parseAndValidateProjectConfig } from './projectConfigParser';

type CacheValue = string | boolean | number;

/**
 * Single source of truth for every commitSage.* setting we read.
 * Adding a new setting:
 *   1. Add an entry here with its default;
 *   2. Read it via ConfigService.get('your.dotted.path').
 * No new wrapper method is needed.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const SETTING_DEFAULTS = {
    'gemini.model': 'auto',
    'commit.commitLanguage': 'english',
    'commit.customLanguageName': '',
    'commit.commitFormat': 'conventional',
    'commit.useCustomInstructions': false,
    'commit.customInstructions': '',
    'commit.promptForRefs': false,
    'commit.onlyStagedChanges': false,
    'commit.autoCommit': false,
    'commit.autoPush': false,
    'commit.useRecentCommitsAsContext': false,
    'commit.recentCommitsCount': 5,
    'commit.recentCommitsScope': 'all',
    'codestral.model': 'codestral-latest',
    'provider.type': 'gemini',
    'ollama.baseUrl': 'http://localhost:11434',
    'ollama.model': 'llama3.2',
    'ollama.useAuthToken': false,
    'openai.model': 'gpt-3.5-turbo',
    'openai.baseUrl': 'https://api.openai.com/v1',
    'openrouter.model': 'meta-llama/llama-3.3-70b-instruct:free',
    'openrouter.preferFreeModels': false,
    'groq.model': 'llama-3.3-70b-versatile',
    'anthropic.model': 'claude-sonnet-4-5-20250929',
    'deepseek.model': 'deepseek-chat',
    'xai.model': 'grok-3-mini',
    'custom.baseUrl': 'http://localhost:1234/v1',
    'custom.model': '',
    'custom.useApiKey': false,
    'custom.chatCompletionsPath': '/chat/completions',
    'general.maxDiffSize': 100000,
    'general.temperature': 0.7,
    'ollama.numCtx': 0,
    'apiRequestTimeout': 30,
    'gitTimeout': 120,
    'telemetry.enabled': true,
    'commit.commitlint.enabled': false,
    'commit.commitlint.maxRetries': 3,
    'commit.commitlint.rulesPath': '',
    'commit.commitlint.engine': 'builtin',
} as const satisfies Record<string, CacheValue>;
/* eslint-enable @typescript-eslint/naming-convention */

type SettingKey = keyof typeof SETTING_DEFAULTS;
// Widen the literal-type defaults (e.g. `30`) back to their general types
// (`number`) so that `ConfigService.get('apiRequestTimeout') === -1` and
// other equality / comparison checks against non-default values type-check.
type Widened<T> =
  T extends boolean ? boolean :
  T extends number ? number :
  T extends string ? string :
  T;
type SettingValue<K extends SettingKey> = Widened<(typeof SETTING_DEFAULTS)[K]>;

export class ConfigService {
  private static readonly cache = new Map<string, CacheValue>();
  private static projectConfigCache: ProjectConfig | null = null;
  private static projectConfigFileWatcher: vscode.FileSystemWatcher | null =
    null;
  private static disposables: vscode.Disposable[] = [];
  private static readonly projectConfigChangeListeners: Array<() => void> = [];

  /**
   * Subscribe to project-config file change/create/delete events. Used by
   * SettingsValidator to re-validate when the user edits .commitsage mid-session
   * (otherwise an invalid edit silently reverts settings to defaults — F052).
   * Decoupled via callback to avoid a circular import between ConfigService and
   * SettingsValidator.
   */
  static onProjectConfigChange(listener: () => void): vscode.Disposable {
    this.projectConfigChangeListeners.push(listener);
    return {
      dispose: () => {
        const idx = this.projectConfigChangeListeners.indexOf(listener);
        if (idx >= 0) {
          this.projectConfigChangeListeners.splice(idx, 1);
        }
      },
    };
  }

  private static async migrateProjectConfig(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const legacyPath = path.join(workspaceFolder.uri.fsPath, '.commitsage');

    try {
      const stats = await statOrUndefined(legacyPath);
      if (stats?.isFile()) {
        const content = await fs.readFile(legacyPath, 'utf8');
        // Validate JSON before migrating to avoid writing broken config
        JSON.parse(content);
        await fs.unlink(legacyPath);
        await fs.mkdir(legacyPath, { recursive: true });
        await fs.writeFile(path.join(legacyPath, 'config.json'), content, 'utf8');
        Logger.log('Migrated .commitsage file to .commitsage/config.json');
      }
    } catch (error) {
      Logger.error('Failed to migrate .commitsage config:', toError(error));
    }
  }

  static async initialize(context: vscode.ExtensionContext): Promise<void> {
    await this.migrateProjectConfig();
    await this.loadProjectConfig();

    const configListener = vscode.workspace.onDidChangeConfiguration(
      (event) => {
        if (event.affectsConfiguration('commitSage')) {
          this.clearCache();
          if (event.affectsConfiguration('commitSage.openai.baseUrl')) {
            const baseUrl = this.get('openai.baseUrl');
            if (baseUrl) {
              try {
                const normalizedEndpoint =
                  this.validateAndNormalizeEndpoint(baseUrl);
                const config = vscode.workspace.getConfiguration('commitSage');
                void config.update('openai.baseUrl', normalizedEndpoint, true);
              } catch (error: unknown) {
                Logger.error(
                  'Failed to update OpenAI base URL:',
                  toError(error),
                );
              }
            }
          }
        }
      },
    );

    this.initializeProjectConfigWatcher(context);

    this.disposables.push(configListener);
    context.subscriptions.push(...this.disposables);
  }

  private static initializeProjectConfigWatcher(
    _context: vscode.ExtensionContext,
  ): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const pattern = new vscode.RelativePattern(workspaceFolder, '{.commitsage,.commitsage/config.json}');
    this.projectConfigFileWatcher =
      vscode.workspace.createFileSystemWatcher(pattern);

    const onChange = (): void => this.handleProjectConfigChange();
    this.projectConfigFileWatcher.onDidCreate(onChange);
    this.projectConfigFileWatcher.onDidChange(onChange);
    this.projectConfigFileWatcher.onDidDelete(onChange);

    this.disposables.push(this.projectConfigFileWatcher);
  }

  private static handleProjectConfigChange(): void {
    this.invalidateProjectConfig();
    // Async reload kicked off but not awaited — sync `ConfigService.get(...)`
    // calls between the file change and the reload will see defaults until
    // the cache repopulates. Async listeners (e.g. SettingsValidator) re-read
    // FS themselves and don't depend on this cache.
    void this.loadProjectConfig();
    for (const listener of this.projectConfigChangeListeners) {
      try {
        listener();
      } catch (error) {
        Logger.error(
          'Project config change listener threw:',
          toError(error),
        );
      }
    }
  }

  private static invalidateProjectConfig(): void {
    this.projectConfigCache = null;
    this.clearCache();
    Logger.log('Project configuration cache invalidated');
  }

  static getProjectRootPath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    if (folders.length === 1) {
      return folders[0].uri.fsPath;
    }

    // Multi-root workspace: prefer the folder containing the active editor.
    const activeFile = vscode.window.activeTextEditor?.document.uri;
    if (activeFile) {
      const owning = vscode.workspace.getWorkspaceFolder(activeFile);
      if (owning) {
        return owning.uri.fsPath;
      }
    }

    // Fallback: the first folder. Documented limitation for multi-root
    // setups where no editor is active.
    return folders[0].uri.fsPath;
  }

  /**
   * Check whether the project's `.commitsage/config.json` (if present)
   * is valid JSON and a plain object. Used by `SettingsValidator` to
   * surface a user-facing dialog on parse errors without re-implementing
   * the parse here. Returns `{ valid: true }` when there is no project
   * config to validate (treated as "no problem").
   */
  static async hasValidProjectConfig(): Promise<{
    valid: boolean;
    error?: Error;
    configPath?: string;
  }> {
    const rootPath = this.getProjectRootPath();
    if (!rootPath) {
      return { valid: true };
    }
    const configPath = path.join(rootPath, '.commitsage', 'config.json');
    if ((await statOrUndefined(configPath)) === undefined) {
      return { valid: true };
    }
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainObject(parsed)) {
        return {
          valid: false,
          configPath,
          error: new Error(
            '.commitsage/config.json is not a JSON object at the top level.',
          ),
        };
      }
      return { valid: true, configPath };
    } catch (error) {
      return { valid: false, configPath, error: toError(error) };
    }
  }

  /**
   * Load project config from disk into the in-memory cache. Called from
   * `initialize` (awaited) and from `handleProjectConfigChange`
   * (fire-and-forget). Synchronous `getConfig`/`get` callers read the
   * resulting cache without further FS access.
   */
  private static async loadProjectConfig(): Promise<void> {
    const rootPath = this.getProjectRootPath();
    if (!rootPath) {
      this.projectConfigCache = {};
      return;
    }
    // Support both legacy `.commitsage` file and new `.commitsage/config.json` directory layout
    const legacyConfigPath = path.join(rootPath, '.commitsage');
    const dirConfigPath = path.join(rootPath, '.commitsage', 'config.json');

    try {
      const dirStats = await statOrUndefined(dirConfigPath);
      if (dirStats !== undefined) {
        const configContent = await fs.readFile(dirConfigPath, 'utf8');
        this.projectConfigCache = parseAndValidateProjectConfig(
          configContent,
          '.commitsage/config.json',
          SETTING_DEFAULTS,
        );
        Logger.log('Loaded project configuration from .commitsage/config.json');
        return;
      }
      const legacyStats = await statOrUndefined(legacyConfigPath);
      if (legacyStats?.isFile()) {
        const configContent = await fs.readFile(legacyConfigPath, 'utf8');
        this.projectConfigCache = parseAndValidateProjectConfig(
          configContent,
          '.commitsage',
          SETTING_DEFAULTS,
        );
        Logger.log('Loaded project configuration from .commitsage file');
        return;
      }
      this.projectConfigCache = {};
    } catch (error) {
      Logger.error('Error reading .commitsage config:', toError(error));
      this.projectConfigCache = {};
    }
  }

  private static getProjectConfig(): ProjectConfig {
    return this.projectConfigCache ?? {};
  }

  private static getNestedProjectValue<T>(
    sections: string[],
  ): T | undefined {
    let current: unknown = this.getProjectConfig();
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const isLeaf = i === sections.length - 1;
      if (!isPlainObject(current)) {
        return undefined;
      }
      if (!(section in current)) {
        return undefined;
      }
      const next = current[section];
      // For non-leaf segments we expect an object to descend into; if a
      // primitive sits where a section is expected, treat as missing rather
      // than throwing.
      if (!isLeaf && !isPlainObject(next)) {
        return undefined;
      }
      current = next;
    }

    return current as T;
  }

  /**
   * Every contributed setting key, prefixed with `commitSage.`. Used by
   * `TelemetryService` to attribute `settings_changed` events without
   * maintaining a hand-rolled list that drifts from `SETTING_DEFAULTS`.
   */
  static readonly knownConfigurationKeys: readonly string[] = (
    Object.keys(SETTING_DEFAULTS) as SettingKey[]
  ).map((k) => `commitSage.${k}`);

  /**
   * Typed accessor over `SETTING_DEFAULTS`. Adding a new setting:
   * extend `SETTING_DEFAULTS` and read it via `ConfigService.get('section.key')`.
   */
  static get<K extends SettingKey>(key: K): SettingValue<K> {
    const defaultValue = SETTING_DEFAULTS[key] as CacheValue;
    const dot = key.indexOf('.');
    const section = dot >= 0 ? key.slice(0, dot) : '';
    const leaf = dot >= 0 ? key.slice(dot + 1) : key;
    return this.getConfig(section, leaf, defaultValue) as SettingValue<K>;
  }

  /**
   * True when `.commitsage/config.json` pins this key, i.e. user/workspace
   * settings for it are ignored. Lets UI mark dead controls instead of
   * silently reverting them. Key uses the same dotted form as `get`.
   */
  static isProjectOverridden(key: string): boolean {
    const dot = key.indexOf('.');
    const sections = dot >= 0 ? [key.slice(0, dot), key.slice(dot + 1)] : [key];
    return this.getNestedProjectValue(sections) !== undefined;
  }

  static getConfig<T extends CacheValue>(
    section: string,
    key: string,
    defaultValue: T,
  ): T {
    const configKey = section ? `${section}.${key}` : key;
    try {
      if (!this.cache.has(configKey)) {
        const projectValue = this.getNestedProjectValue<T>(
          section ? [section, key] : [key],
        );

        if (projectValue !== undefined) {
          this.cache.set(configKey, projectValue);
          return projectValue;
        }

        const config = vscode.workspace.getConfiguration('commitSage');
        const value = config.inspect<T>(configKey);

        const effectiveValue =
          value?.workspaceValue ??
          value?.globalValue ??
          value?.defaultValue ??
          defaultValue;

        this.cache.set(configKey, effectiveValue);
      }
      return this.cache.get(configKey) as T;
    } catch (error) {
      Logger.error(`Error getting config ${configKey}:`, toError(error));
      return defaultValue;
    }
  }

  static getProvider(): string {
    const provider = this.get('provider.type');
    if (!isProvider(provider)) {
      Logger.warn(
        `Invalid provider type: ${provider}, falling back to gemini`,
      );
      return 'gemini';
    }
    return provider;
  }

  /**
   * Configured model for the active provider (e.g. `gemini-2.5-flash`,
   * `gpt-3.5-turbo`, `llama3.2`, `codestral-latest`). Reads `<provider>.model`
   * from settings — for `gemini` this can be the literal `'auto'`, which
   * resolves to the actual model only inside `geminiService`. The resolved
   * model is reported by `message_generation_completed.model`; this helper
   * is for events that fire before resolution (`started`, `failed`).
   */
  static getModel(): string {
    return this.getModelFor(this.getProvider());
  }

  /**
   * Configured model id for an arbitrary provider (`<provider>.model`). The
   * model key is always `<provider>.model` and every provider id has such an
   * entry in `SETTING_DEFAULTS`, so this derives the right key without a
   * per-provider switch. Used by the shared OpenAI-compatible dispatcher and
   * `getModel()` (active provider).
   */
  static getModelFor(provider: string): string {
    return this.get(`${provider}.model` as SettingKey) as string;
  }

  static clearCache(): void {
    this.cache.clear();
  }

  static dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.clearCache();
    this.projectConfigCache = null;
    if (this.projectConfigFileWatcher) {
      this.projectConfigFileWatcher.dispose();
      this.projectConfigFileWatcher = null;
    }
  }

  private static validateAndNormalizeEndpoint(endpoint: string): string {
    if (!endpoint) {
      return '';
    }

    let normalizedEndpoint = endpoint.trim();
    if (
      !normalizedEndpoint.startsWith('http://') &&
      !normalizedEndpoint.startsWith('https://')
    ) {
      normalizedEndpoint = `https://${normalizedEndpoint}`;
    }

    if (normalizedEndpoint.endsWith('/')) {
      normalizedEndpoint = normalizedEndpoint.slice(0, -1);
    }

    return normalizedEndpoint;
  }

}
