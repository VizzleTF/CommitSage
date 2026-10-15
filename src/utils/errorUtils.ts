export function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error));
}

const PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\/)[^\s:,'"]{1,256}\.[a-zA-Z]{1,16}/g;
const URL_KEY_PATTERN = /([?&])key=[^&\s'"]+/gi;
const BEARER_PATTERN = /Bearer\s+[A-Z0-9._-]+/gi;
const GOOGLE_API_KEY_HEADER = /x-goog-api-key:\s*[^\s'",]+/gi;
// Consumes the scheme too (`Authorization: Bearer sk-…`), otherwise only the
// word "Bearer" is masked and the token survives.
const AUTHORIZATION_HEADER = /Authorization:\s*(?:[A-Za-z]+\s+)?[^\s'",]+/gi;

// Token formats curated from the gitleaks default rules
// (https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml),
// rule ids in the comments. Each alternative starts with a fixed prefix and
// never crosses a newline, and no quantifier can backtrack into another, so
// matching stays linear in the input (no ReDoS).
const TOKEN_PATTERN = new RegExp([
    String.raw`\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b`, // aws-access-token
    // github-pat, github-oauth, github-app-token, github-refresh-token
    String.raw`\bgh[pousr]_[0-9a-zA-Z]{36}`,
    String.raw`\bgithub_pat_\w{82}`, // github-fine-grained-pat
    String.raw`\bglpat-[\w-]{20,300}(?:\.[0-9a-z]{9})?`, // gitlab-pat, gitlab-pat-routable
    // slack-bot-token, slack-user-token, slack-legacy-*-token, slack-app-token
    String.raw`\bxox[abeoprs]-[\w-]{8,300}`,
    String.raw`\bxapp-\d-[\w-]{8,300}`,
    String.raw`\b(?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99}`, // stripe-access-token
    String.raw`\bAIza[\w-]{35}`, // gcp-api-key
    // anthropic-api-key, anthropic-admin-api-key: any `sk-ant-` token.
    String.raw`\bsk-ant-[\w-]{20,300}`,
    // openai-api-key, widened to every `sk-proj-` style key and to bare
    // `sk-` + 32 alphanumerics (legacy OpenAI, DeepSeek).
    String.raw`\bsk-(?:proj|svcacct|admin)-[\w-]{20,300}`,
    String.raw`\bsk-[a-zA-Z0-9]{32,300}`,
    // Not in gitleaks: keys of providers this extension calls, by their
    // documented prefix (OpenRouter `sk-or-v1-`, Groq `gsk_`, xAI `xai-`).
    String.raw`\bsk-or-v1-[\w-]{20,300}`,
    String.raw`\bgsk_[a-zA-Z0-9]{20,300}`,
    String.raw`\bxai-[a-zA-Z0-9]{20,300}`,
    String.raw`\bhf_[a-zA-Z]{34}\b`, // huggingface-access-token
    String.raw`\bnpm_[a-zA-Z0-9]{36}\b`, // npm-access-token
    String.raw`\bey[a-zA-Z0-9]{17,}\.ey[\w/\\-]{17,}\.(?:[\w/\\-]{10,}={0,2})?`, // jwt
].join('|'), 'g');

// gitleaks generic-api-key, narrowed instead of its entropy check: the name
// must end in a secret word and the value must be quoted, 8+ characters, with
// no spaces. `sortKey: "createdAt"` or `tokenType: "Bearer"` stay readable.
const SECRET_ASSIGNMENT =
    /\b([\w.-]{0,40}?(?:(?:api|access|auth|client|private|secret|signing)[_.-]?key|secret|token|passw(?:or)?d|pwd)["']?\s{0,5}(?::=|=>|[:=])\s{0,5})(["'`])[^\s"'`<>]{8,200}\2/gi;

/**
 * Strip API secrets (auth headers, `?key=` query params, known token formats,
 * quoted `password = "…"` style assignments) from arbitrary text. Separate
 * from `redactSecrets` because the local log wants readable file paths, while
 * telemetry must not carry them off the machine.
 */
export function redactApiSecrets(text: string): string {
    return text
        .replace(URL_KEY_PATTERN, '$1key=<redacted>')
        .replace(BEARER_PATTERN, 'Bearer <redacted>')
        .replace(GOOGLE_API_KEY_HEADER, 'x-goog-api-key: <redacted>')
        .replace(AUTHORIZATION_HEADER, 'Authorization: <redacted>')
        .replace(TOKEN_PATTERN, '<redacted>')
        .replace(SECRET_ASSIGNMENT, '$1$2<redacted>$2');
}

// gitleaks private-key. Matched per line, so a block's body is tracked across
// lines below instead of one `[\s\S]*?` scan that is quadratic on many BEGINs.
const PRIVATE_KEY_BEGIN = /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/gi;
const PRIVATE_KEY_END = /-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/gi;
const BASE64_LINE = /^\s*[A-Za-z0-9+/=]+\s*$/;

/**
 * Mask private-key bodies on a line that opens a block. Handles one-line
 * blocks (a JSON `"-----BEGIN…\n…\n-----END…"` string). Returns whether a
 * block is still open at the end of the line.
 */
function maskKeyBlocksOnLine(line: string): [string, boolean] {
    let out = '';
    let pos = 0;
    for (;;) {
        PRIVATE_KEY_BEGIN.lastIndex = pos;
        const begin = PRIVATE_KEY_BEGIN.exec(line);
        if (!begin) {
            return [out + line.slice(pos), false];
        }
        out += line.slice(pos, PRIVATE_KEY_BEGIN.lastIndex);
        pos = PRIVATE_KEY_BEGIN.lastIndex;
        PRIVATE_KEY_END.lastIndex = pos;
        const end = PRIVATE_KEY_END.exec(line);
        if (!end) {
            return [out + (pos < line.length ? '<redacted>' : ''), true];
        }
        out += `<redacted>${end[0]}`;
        pos = PRIVATE_KEY_END.lastIndex;
    }
}

/**
 * Mask secrets in a git diff before it reaches the model. Works line by line,
 * so a match never eats a newline or a line's `+`/`-`/` ` prefix, and hunk
 * headers keep their shape. Inside a multi-line private key every base64 body
 * line becomes `<prefix><redacted>`.
 */
export function redactDiffSecrets(diff: string): string {
    let inKey = false;
    return diff.split('\n').map((line) => {
        if (inKey) {
            PRIVATE_KEY_END.lastIndex = 0;
            if (line.startsWith('diff --git ') || PRIVATE_KEY_END.test(line)) {
                inKey = false;
            } else if (!/^[+\- ]/.test(line) || !line.slice(1).trim()) {
                return line; // hunk header, "\ No newline", blank body line
            } else if (BASE64_LINE.test(line.slice(1))) {
                return `${line[0]}<redacted>`;
            } else {
                inKey = false; // code that only quotes a BEGIN marker
            }
        }
        const [masked, open] = maskKeyBlocksOnLine(line);
        inKey = open;
        return redactApiSecrets(masked);
    }).join('\n');
}

/** Strip filesystem paths and API secrets from arbitrary text. */
export function redactSecrets(text: string): string {
    return redactApiSecrets(text.replace(PATH_PATTERN, '<path>'));
}

/** Coarse error class sent to telemetry instead of the message. */
export type ErrorCategory =
    | 'auth' | 'rate_limit' | 'network' | 'timeout' | 'server' | 'http' | 'git' | 'cancelled' | 'other';

const CATEGORY_BY_NAME = new Map<string, ErrorCategory>([
    ['UserCancelledError', 'cancelled'],
    ['AbortError', 'cancelled'],
    ['ApiKeyInvalidError', 'auth'],
    ['NetworkError', 'network'],
    ['TimeoutError', 'timeout'],
    ['GitTimeoutError', 'timeout'],
    ['GitCommandError', 'git'],
]);

function httpCategory(status: number): ErrorCategory {
    if (status === 401 || status === 403) {
        return 'auth';
    }
    if (status === 429) {
        return 'rate_limit';
    }
    return status >= 500 ? 'server' : 'http';
}

/**
 * Walks the `cause` chain, where the deepest known error wins: the retry
 * wrapper hides an HttpError, a NetworkError hides the fetch TimeoutError.
 * Matches `name`, not classes, so this module imports nothing.
 */
export function categorizeError(error: Error): ErrorCategory {
    let category: ErrorCategory = 'other';
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
        const { name, status, cause } = current as { name?: unknown; status?: unknown; cause?: unknown };
        if (name === 'HttpError' && typeof status === 'number') {
            category = httpCategory(status);
        } else if (typeof name === 'string') {
            category = CATEGORY_BY_NAME.get(name) ?? category;
        }
        current = cause;
    }
    return category;
}

/**
 * Never the message: it can quote git stderr (hook output, remote URLs,
 * branch names) or a provider's reply.
 */
export function sanitizeErrorForTelemetry(error: Error): { errorType: string; errorCategory: ErrorCategory } {
    return {
        // Not `constructor.name`: the production bundle is minified, so class
        // names come out as `At` / `_r`. Every custom error sets `name`.
        errorType: error.name,
        errorCategory: categorizeError(error),
    };
}
