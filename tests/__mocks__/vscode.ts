/**
 * Minimal stub of the vscode module for vitest. Only includes APIs used by
 * the modules under test in this directory. Add fields as needed.
 */

const noopOutput = {
    appendLine: () => undefined,
    append: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
};

export const window = {
    createOutputChannel: () => noopOutput,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    activeTextEditor: undefined as unknown,
    showQuickPick: async () => undefined,
    showTextDocument: async () => undefined,
    withProgress: async (_opts: unknown, task: (...a: unknown[]) => unknown) =>
        task({ report: () => undefined }, { isCancellationRequested: false }),
};

export const workspace = {
    workspaceFolders: undefined as unknown,
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
}

export const ProgressLocation = { Notification: 15 };

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
};
