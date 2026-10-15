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

// CommitLint types
export interface CommitLintRules {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface CommitLintConfig {
  rules: CommitLintRules;
  extends?: string | string[];
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