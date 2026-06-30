/**
 * Minimal stub of the vscode module for vitest. Only includes APIs used by
 * the modules under test in this directory. Add fields as needed.
 */

const noopOutput = {
    appendLine: () => undefined,
    append: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
    // LogOutputChannel surface (when createOutputChannel is called with { log: true }).
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    logLevel: 0,
    onDidChangeLogLevel: () => ({ dispose: () => undefined }),
};

export const window = {
    createOutputChannel: (_name: string, _options?: unknown) => noopOutput,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    activeTextEditor: undefined as unknown,
    showQuickPick: async () => undefined,
    showTextDocument: async () => undefined,
    withProgress: async (_opts: unknown, task: (...a: unknown[]) => unknown) =>
        task(
            { report: () => undefined },
            {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: () => undefined }),
            },
        ),
    registerUriHandler: (_handler: unknown) => ({ dispose: () => undefined }),
};

export const workspace = {
    workspaceFolders: undefined as unknown,
    isTrusted: true,
    getConfiguration: () => ({
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
        update: async () => undefined,
        // Production code reads ConfigService.get -> getConfiguration().inspect()
        // for layered settings. Returning undefined here lets the SETTING_DEFAULTS
        // fallback run — which is what unit tests want by default. Tests that need
        // a specific workspace/global value should mock ConfigService directly.
        inspect: <T>(_key: string): {
            key: string;
            defaultValue?: T;
            workspaceValue?: T;
            globalValue?: T;
        } | undefined => undefined,
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose: () => undefined }),
        onDidCreate: () => ({ dispose: () => undefined }),
        onDidDelete: () => ({ dispose: () => undefined }),
        dispose: () => undefined,
    }),
};

export const env = {
    machineId: 'test-machine',
    sessionId: 'test-session',
    language: 'en',
    appName: 'vscode-test',
    uriScheme: 'vscode',
    openExternal: async (_uri: unknown) => true,
    asExternalUri: async (uri: unknown) => uri,
    isTelemetryEnabled: true,
    onDidChangeTelemetryEnabled: () => ({ dispose: () => undefined }),
    createTelemetryLogger: (_sender: unknown, _options?: unknown) => ({
        logUsage: () => undefined,
        logError: () => undefined,
        dispose: () => undefined,
        onDidChangeEnableStates: () => ({ dispose: () => undefined }),
        isUsageEnabled: true,
        isErrorsEnabled: true,
    }),
};

export const extensions = {
    getExtension: () => undefined,
};

export const commands = {
    registerCommand: () => ({ dispose: () => undefined }),
    executeCommand: async () => undefined,
};

export class Uri {
    static file(p: string) {
        return { fsPath: p };
    }

    // Minimal URI parse adequate for the OAuth callback round-trip:
    // splits scheme://authority/path?query and round-trips toString().
    static parse(value: string) {
        const [beforeQuery, query = ''] = value.split('?');
        const schemeIdx = beforeQuery.indexOf('://');
        const rest = schemeIdx >= 0 ? beforeQuery.slice(schemeIdx + 3) : beforeQuery;
        const slash = rest.indexOf('/');
        const path = slash >= 0 ? rest.slice(slash) : '';
        return {
            path,
            query,
            fsPath: beforeQuery,
            toString: (_skipEncoding?: boolean) => value,
        };
    }
}

export const ProgressLocation = { Notification: 15 };

export const l10n = {
    t: (message: string, ...args: Array<string | number | boolean>): string => {
        if (args.length === 0) {
            return message;
        }
        // Index-based templating: replace {0}, {1}, … with positional args.
        return message.replace(/\{(\d+)\}/g, (_, idx) => String(args[Number(idx)] ?? ''));
    },
    bundle: undefined as unknown,
    uri: undefined as unknown,
};

export class EventEmitter<T> {
    public event = (_listener: (e: T) => unknown) => ({ dispose: () => undefined });
    fire(_e: T) { /* no-op */ }
    dispose() { /* no-op */ }
}

export default {
    window,
    workspace,
    env,
    extensions,
    commands,
    Uri,
    ProgressLocation,
    EventEmitter,
    l10n,
};
