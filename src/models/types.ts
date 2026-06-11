export interface CommitMessage {
    message: string;
    model: string;
}

export interface ProgressReporter {
    report(value: { message?: string; increment?: number }): void;
}

export interface GenerateOptions {
    maxTokens?: number;
    signal?: AbortSignal;
}

export interface ApiErrorResult {
    errorMessage: string;
    shouldRetry: boolean;
    statusCode?: number;
}

/**
 * Project-level config shape mirrored from `package.json`'s
 * `commitSage.*` settings. Leaf types are intentionally lax — the only
 * enforcement at parse time is "every section is a plain object" (see
 * `parseAndValidateProjectConfig`). Stricter validation is done by VS
 * Code's settings schema for workspace/global config; keep this in sync
 * with `package.json` `contributes.configuration.properties`.
 */
export interface ProjectConfig {
    provider?: {
        type?: string;
    };
    commit?: {
        commitLanguage?: string;
        customLanguageName?: string;
        commitFormat?: string;
        useCustomInstructions?: boolean;
        customInstructions?: string;
        onlyStagedChanges?: boolean;
        autoCommit?: boolean;
        autoPush?: boolean;
        promptForRefs?: boolean;
        commitlint?: {
            enabled?: boolean;
            maxRetries?: number;
            rulesPath?: string;
        };
    };
    gemini?: {
        model?: string;
    };
    codestral?: {
        model?: string;
    };
    openai?: {
        model?: string;
        baseUrl?: string;
    };
    ollama?: {
        baseUrl?: string;
        model?: string;
        useAuthToken?: boolean;
        numCtx?: number;
    };
    openrouter?: {
        model?: string;
        preferFreeModels?: boolean;
    };
    groq?: {
        model?: string;
    };
    anthropic?: {
        model?: string;
    };
    deepseek?: {
        model?: string;
    };
    xai?: {
        model?: string;
    };
    custom?: {
        baseUrl?: string;
        model?: string;
        useApiKey?: boolean;
        chatCompletionsPath?: string;
    };
    general?: {
        maxDiffSize?: number;
        temperature?: number;
    };
    telemetry?: {
        enabled?: boolean;
    };
}

// CommitLint types
export interface CommitLintRules {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface CommitLintConfig {
  rules: CommitLintRules;
  extends?: string | string[];
}

export interface CommitLintError {
  message: string;
  level?: number;
}

export interface CommitLintResult {
  valid: boolean;
  errors: string[];
}

export interface ParsedCommit {
  header: string;
  type: string;
  scope: string | null;
  subject: string;
  body: string;
  footer: string;
}