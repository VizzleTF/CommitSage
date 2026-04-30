import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { ProjectConfig } from '../models/types';
import { toError } from './errorUtils';

export type { CommitLanguage } from './constants';

type CacheValue = string | boolean | number;

/**
 * Single source of truth for every commitSage.* setting we read.
 * Adding a new setting:
 *   1. Add an entry here with its default;
 *   2. Read it via ConfigService.get('your.dotted.path').
 * No new wrapper method is needed.
 */
/* eslint-disable @typescript-eslint/naming-convention */
const SETTING_DEFAULTS = {
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
    'codestral.model': 'codestral-2405',
    'provider.type': 'gemini',
    'general.maxRetries': 3,
    'ollama.baseUrl': 'http://localhost:11434',
    'ollama.model': 'llama3.2',
    'ollama.useAuthToken': false,
    'openai.model': 'gpt-3.5-turbo',
    'openai.baseUrl': 'https://api.openai.com/v1',
    'apiRequestTimeout': 30,
    'gitTimeout': 120,
    'telemetry.enabled': true,
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
  private static cache = new Map<string, CacheValue>();
  private static projectConfigCache: ProjectConfig | null = null;
  private static projectConfigFileWatcher: vscode.FileSystemWatcher | null =
    null;
  private static disposables: vscode.Disposable[] = [];

  private static migrateProjectConfig(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const legacyPath = path.join(workspaceFolder.uri.fsPath, '.commitsage');

    try {
      if (fs.existsSync(legacyPath) && fs.statSync(legacyPath).isFile()) {
        const content = fs.readFileSync(legacyPath, 'utf8');
        // Validate JSON before migrating to avoid writing broken config
        JSON.parse(content);
        fs.unlinkSync(legacyPath);
        fs.mkdirSync(legacyPath, { recursive: true });
        fs.writeFileSync(path.join(legacyPath, 'config.json'), content, 'utf8');
        Logger.log('Migrated .commitsage file to .commitsage/config.json');
      }
    } catch (error) {
      Logger.error('Failed to migrate .commitsage config:', toError(error));
    }
  }

  static async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.migrateProjectConfig();

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

    this.projectConfigFileWatcher.onDidCreate(() => {
      this.invalidateProjectConfig();
    });

    this.projectConfigFileWatcher.onDidChange(() => {
      this.invalidateProjectConfig();
    });

    this.projectConfigFileWatcher.onDidDelete(() => {
      this.invalidateProjectConfig();
    });

    this.disposables.push(this.projectConfigFileWatcher);
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
  static hasValidProjectConfig(): {
    valid: boolean;
    error?: Error;
    configPath?: string;
  } {
    const rootPath = this.getProjectRootPath();
    if (!rootPath) {
      return { valid: true };
    }
    const configPath = path.join(rootPath, '.commitsage', 'config.json');
    if (!fs.existsSync(configPath)) {
      return { valid: true };
    }
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!this.isPlainObject(parsed)) {
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

  private static getProjectConfig(): ProjectConfig | null {
    if (this.projectConfigCache !== null) {
      return this.projectConfigCache;
    }

    const rootPath = this.getProjectRootPath();
    if (!rootPath) {
      this.projectConfigCache = {};
      return this.projectConfigCache;
    }
    // Support both legacy `.commitsage` file and new `.commitsage/config.json` directory layout
    const legacyConfigPath = path.join(rootPath, '.commitsage');
    const dirConfigPath = path.join(rootPath, '.commitsage', 'config.json');

    try {
      if (fs.existsSync(dirConfigPath)) {
        const configContent = fs.readFileSync(dirConfigPath, 'utf8');
        this.projectConfigCache = this.parseAndValidateProjectConfig(
          configContent,
          '.commitsage/config.json',
        );
        Logger.log('Loaded project configuration from .commitsage/config.json');
      } else if (fs.existsSync(legacyConfigPath) && fs.statSync(legacyConfigPath).isFile()) {
        const configContent = fs.readFileSync(legacyConfigPath, 'utf8');
        this.projectConfigCache = this.parseAndValidateProjectConfig(
          configContent,
          '.commitsage',
        );
        Logger.log('Loaded project configuration from .commitsage file');
      } else {
        this.projectConfigCache = {};
      }
    } catch (error) {
      Logger.error('Error reading .commitsage config:', toError(error));
      this.projectConfigCache = {};
    }

    return this.projectConfigCache;
  }

  private static parseAndValidateProjectConfig(
    raw: string,
    source: string,
  ): ProjectConfig {
    const parsed = JSON.parse(raw) as unknown;
    if (!this.isPlainObject(parsed)) {
      Logger.warn(
        `Project config at ${source} is not an object — ignoring.`,
      );
      return {};
    }
    // Drop top-level keys that are not plain objects (e.g. `commit: false`),
    // since downstream code descends through them and would otherwise misread.
    const validated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (this.isPlainObject(value)) {
        validated[key] = value;
      } else {
        Logger.warn(
          `Project config at ${source}: section "${key}" is not an object, skipping.`,
        );
      }
    }
    return validated as ProjectConfig;
  }

  private static isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private static getNestedProjectValue<T>(
    sections: string[],
    _defaultValue: T,
  ): T | undefined {
    const projectConfig = this.getProjectConfig();
    if (!projectConfig) {
      return undefined;
    }

    let current: unknown = projectConfig;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const isLeaf = i === sections.length - 1;
      if (!this.isPlainObject(current)) {
        return undefined;
      }
      if (!(section in current)) {
        return undefined;
      }
      const next = current[section];
      // For non-leaf segments we expect an object to descend into; if a
      // primitive sits where a section is expected, treat as missing rather
      // than throwing.
      if (!isLeaf && !this.isPlainObject(next)) {
        return undefined;
      }
      current = next;
    }

    return current as T;
  }

  /**
   * Typed accessor over SETTING_DEFAULTS. Prefer this over the legacy
   * getXxx wrappers when adding new code.
   */
  static get<K extends SettingKey>(key: K): SettingValue<K> {
    const defaultValue = SETTING_DEFAULTS[key] as CacheValue;
    const dot = key.indexOf('.');
    const section = dot >= 0 ? key.slice(0, dot) : '';
    const leaf = dot >= 0 ? key.slice(dot + 1) : key;
    return this.getConfig(section, leaf, defaultValue) as SettingValue<K>;
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
          defaultValue,
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
    if (!['gemini', 'openai', 'codestral', 'ollama'].includes(provider)) {
      Logger.warn(
        `Invalid provider type: ${provider}, falling back to gemini`,
      );
      return 'gemini';
    }
    return provider;
  }

  static clearCache(): void {
    this.cache.clear();
  }

  static dispose(): void {
    this.disposables.forEach((d) => void d.dispose());
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
