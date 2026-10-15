export interface CommitMessage {
    message: string;
    model: string;
    /** The project's commitlint rules require a Signed-off-by trailer; git adds it, never the model. */
    signOff?: boolean;
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
    /** The wait the provider asked for (Retry-After); replaces the backoff. */
    retryAfterMs?: number;
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
  /** A rule requires a Signed-off-by trailer; its error is left out of `errors`. */
  signOffRequired?: boolean;
}

export interface ParsedCommit {
  header: string;
  type: string;
  scope: string | null;
  subject: string;
  body: string;
  footer: string;
}