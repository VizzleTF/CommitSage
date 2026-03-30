import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "./logger";
import { ProjectConfig } from "../models/types";
import { toError } from "./errorUtils";

export type { CommitLanguage } from "./constants";

type CacheValue = string | boolean | number;

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

    const legacyPath = path.join(workspaceFolder.uri.fsPath, ".commitsage");

    try {
      if (fs.existsSync(legacyPath) && fs.statSync(legacyPath).isFile()) {
        const content = fs.readFileSync(legacyPath, "utf8");
        // Validate JSON before migrating to avoid writing broken config
        JSON.parse(content);
        fs.unlinkSync(legacyPath);
        fs.mkdirSync(legacyPath, { recursive: true });
        fs.writeFileSync(path.join(legacyPath, "config.json"), content, "utf8");
        Logger.log("Migrated .commitsage file to .commitsage/config.json");
      }
    } catch (error) {
      Logger.error("Failed to migrate .commitsage config:", toError(error));
    }
  }

  static async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.migrateProjectConfig();

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

    const pattern = new vscode.RelativePattern(workspaceFolder, "{.commitsage,.commitsage/config.json}");
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

  static getProjectRootPath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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

    const rootPath = workspaceFolder.uri.fsPath;
    // Support both legacy `.commitsage` file and new `.commitsage/config.json` directory layout
    const legacyConfigPath = path.join(rootPath, ".commitsage");
    const dirConfigPath = path.join(rootPath, ".commitsage", "config.json");

    try {
      if (fs.existsSync(dirConfigPath)) {
        const configContent = fs.readFileSync(dirConfigPath, "utf8");
        const config = JSON.parse(configContent) as ProjectConfig;
        this.projectConfigCache = config;
        Logger.log("Loaded project configuration from .commitsage/config.json");
      } else if (fs.existsSync(legacyConfigPath) && fs.statSync(legacyConfigPath).isFile()) {
        const configContent = fs.readFileSync(legacyConfigPath, "utf8");
        const config = JSON.parse(configContent) as ProjectConfig;
        this.projectConfigCache = config;
        Logger.log("Loaded project configuration from .commitsage file");
      } else {
        this.projectConfigCache = {};
      }
    } catch (error) {
      Logger.error("Error reading .commitsage config:", toError(error));
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

        const config = vscode.workspace.getConfiguration("commitSage");
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

  static getGeminiModel(): string {
    return this.getConfig<string>("gemini", "model", "gemini-1.5-flash");
  }

  static getCommitLanguage(): string {
    return this.getConfig<string>("commit", "commitLanguage", "english");
  }

  static getCustomLanguageName(): string {
    return this.getConfig<string>("commit", "customLanguageName", "");
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

  static getOllamaUseAuthToken(): boolean {
    return this.getConfig<boolean>("ollama", "useAuthToken", false);
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
