// Whitelist of env vars forwarded to `git`. Spreading `process.env` would
// (a) leak unrelated secrets the parent process holds (CI tokens, our own
// AMPLITUDE_API_KEY in dev) and (b) let arbitrary `GIT_*` vars in the
// parent shell mutate git's behaviour in ways the extension can't predict.
const GIT_ENV_WHITELIST = [
    'PATH',
    'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA',
    'TEMP', 'TMP', 'TMPDIR',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES',
    'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
    'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_SSL_CAINFO', 'GIT_SSL_CAPATH',
    'GIT_SSH', 'GIT_SSH_COMMAND',
    'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
] as const;

export function buildGitEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const k of GIT_ENV_WHITELIST) {
        const v = process.env[k];
        if (v !== undefined) {
            env[k] = v;
        }
    }
    env.GIT_TERMINAL_PROMPT = '0';
    return env;
}
