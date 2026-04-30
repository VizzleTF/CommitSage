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
    };
    telemetry?: {
        enabled?: boolean;
    };
}
