import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "./logger";
import { ProjectConfig } from "../models/types";
import { toError } from "./errorUtils";

type CacheValue = string | boolean | number;

export type CommitLanguage =
  | "english"
  | "russian"
  | "chinese"
  | "japanese"
  | "spanish";

export class ConfigService {
  private static cache = new Map<string, CacheValue>();
  private static projectConfigCache: ProjectConfig | null = null;
  private static projectConfigFileWatcher: vscode.FileSystemWatcher | null =
    null;
  private static disposables: vscode.Disposable[] = [];

  static async initialize(context: vscode.ExtensionContext): Promise<void> {
    const configListener = vscode.workspace.onDidChangeConfiguration(
      (event) => {
        if (event.affectsConfiguration("commitSage")) {
          this.clearCache();
          if (event.affectsConfiguration("commitSage.openai.baseUrl")) {
            const baseUrl = this.getOpenAIBaseUrl();
            if (baseUrl) {
              try {
                const normalizedEndpoint =
                  this.validateAndNormalizeEndpoint(baseUrl);
                const config = vscode.workspace.getConfiguration("commitSage");
                void config.update("openai.baseUrl", normalizedEndpoint, true);
              } catch (error: unknown) {
                Logger.error(
                  "Failed to update OpenAI base URL:",
                  toError(error),
                );
              }
            }
          }
        }
      },
    );

    // Инициализируем наблюдение за файлом .commitsage
    this.initializeProjectConfigWatcher(context);

    this.disposables.push(configListener);
    context.subscriptions.push(...this.disposables);
  }

  private static initializeProjectConfigWatcher(
    context: vscode.ExtensionContext,
  ): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const pattern = new vscode.RelativePattern(workspaceFolder, ".commitsage");
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
    Logger.log("Project configuration cache invalidated");
  }

  private static getProjectConfig(): ProjectConfig | null {
    if (this.projectConfigCache !== null) {
      return this.projectConfigCache;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.projectConfigCache = {};
      return this.projectConfigCache;
    }

    const configPath = path.join(workspaceFolder.uri.fsPath, ".commitsage");

    try {
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, "utf8");
        const config = JSON.parse(configContent) as ProjectConfig;
        this.projectConfigCache = config;
        Logger.log("Loaded project configuration from .commitsage file");
      } else {
        this.projectConfigCache = {};
      }
    } catch (error) {
      Logger.error("Error reading .commitsage file:", toError(error));
      this.projectConfigCache = {};
    }

    return this.projectConfigCache;
  }

  private static getNestedProjectValue<T>(
    sections: string[],
    _defaultValue: T,
  ): T | undefined {
    const projectConfig = this.getProjectConfig();
    if (!projectConfig) {
      return undefined;
    }

    let current: Record<string, unknown> = projectConfig as Record<
      string,
      unknown
    >;
    for (const section of sections) {
      if (current && typeof current === "object" && section in current) {
        current = current[section] as Record<string, unknown>;
      } else {
        return undefined;
      }
    }

    return current as T;
  }

  static getConfig<T extends CacheValue>(
    section: string,
    key: string,
    defaultValue: T,
  ): T {
    const configKey = section ? `${section}.${key}` : key;
    const cacheKey = configKey;
    try {
      if (!this.cache.has(cacheKey)) {
        // Сначала проверяем настройки проекта
        const projectValue = this.getNestedProjectValue<T>(
          section ? [section, key] : [key],
          defaultValue,
        );

        if (projectValue !== undefined) {
          this.cache.set(cacheKey, projectValue);
          return projectValue;
        }

        const config = vscode.workspace.getConfiguration("commitSage");
        const value = config.inspect<T>(configKey);

        const effectiveValue =
          value?.workspaceValue ??
          value?.globalValue ??
          value?.defaultValue ??
          defaultValue;

        this.cache.set(cacheKey, effectiveValue);
      }
      return this.cache.get(cacheKey) as T;
    } catch (error) {
      Logger.error(`Error getting config ${configKey}:`, toError(error));
      return defaultValue;
    }
  }

  static getGeminiModel(): string {
    return this.getConfig<string>("gemini", "model", "gemini-1.5-flash");
  }

  static getCommitLanguage(): string {
    return this.getConfig<string>("commit", "commitLanguage", "english");
  }

  static getCommitFormat(): string {
    return this.getConfig<string>("commit", "commitFormat", "conventional");
  }

  static useCustomInstructions(): boolean {
    return this.getConfig<boolean>("commit", "useCustomInstructions", false);
  }

  static getCustomInstructions(): string {
    return this.getConfig<string>("commit", "customInstructions", "");
  }

  static getCodestralModel(): string {
    return this.getConfig<string>("codestral", "model", "codestral-2405");
  }

  static getProvider(): string {
    const provider = this.getConfig<string>("provider", "type", "gemini");
    if (!["gemini", "openai", "codestral", "ollama"].includes(provider)) {
      Logger.warn(
        `Invalid provider type: ${provider}, falling back to gemini`,
      );
      return "gemini";
    }
    return provider;
  }

  static shouldPromptForRefs(): boolean {
    return this.getConfig<boolean>("commit", "promptForRefs", false);
  }

  static getOnlyStagedChanges(): boolean {
    return this.getConfig<boolean>("commit", "onlyStagedChanges", false);
  }

  static getMaxRetries(): number {
    return this.getConfig<number>("general", "maxRetries", 3);
  }

  static getAutoCommitEnabled(): boolean {
    return this.getConfig<boolean>("commit", "autoCommit", false);
  }

  static getAutoPushEnabled(): boolean {
    return this.getConfig<boolean>("commit", "autoPush", false);
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

  static isTelemetryEnabled(): boolean {
    return this.getConfig<boolean>("telemetry", "enabled", true);
  }

  private static validateAndNormalizeEndpoint(endpoint: string): string {
    if (!endpoint) {
      return "";
    }

    let normalizedEndpoint = endpoint.trim();
    if (
      !normalizedEndpoint.startsWith("http://") &&
      !normalizedEndpoint.startsWith("https://")
    ) {
      normalizedEndpoint = `https://${normalizedEndpoint}`;
    }

    if (normalizedEndpoint.endsWith("/")) {
      normalizedEndpoint = normalizedEndpoint.slice(0, -1);
    }

    return normalizedEndpoint;
  }

  static getOllamaBaseUrl(): string {
    return this.getConfig<string>(
      "ollama",
      "baseUrl",
      "http://localhost:11434",
    );
  }

  static getOllamaModel(): string {
    return this.getConfig<string>("ollama", "model", "mistral");
  }

  static getOpenAIModel(): string {
    return this.getConfig<string>("openai", "model", "gpt-3.5-turbo");
  }

  static getOpenAIBaseUrl(): string {
    return this.getConfig<string>(
      "openai",
      "baseUrl",
      "https://api.openai.com/v1",
    );
  }

  static getApiRequestTimeout(): number {
    return this.getConfig<number>("", "apiRequestTimeout", 30);
  }
}
