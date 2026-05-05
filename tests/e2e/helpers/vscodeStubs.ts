import * as sinon from 'sinon';
import * as vscode from 'vscode';

let sandbox: sinon.SinonSandbox = sinon.createSandbox();

/**
 * Install safety nets so a missing test stub never blocks the run on a
 * modal popup. Tests that genuinely need a specific value override these
 * defaults via `stubQuickPick` / `stubInputBox`.
 */
export function installDefaultUiStubs(opts?: {
    quickPick?: unknown;
    inputBox?: string;
}): void {
    replaceStub('showInformationMessage').resolves(undefined as never);
    replaceStub('showWarningMessage').resolves(undefined as never);
    replaceStub('showErrorMessage').resolves(undefined as never);
    replaceStub('showQuickPick').resolves((opts?.quickPick ?? undefined) as never);
    replaceStub('showInputBox').resolves(opts?.inputBox as never);
}

function replaceStub(method: keyof typeof vscode.window): sinon.SinonStub {
    const target = vscode.window as unknown as Record<string, unknown>;
    const current = target[method as string] as unknown as { restore?: () => void } | undefined;
    if (current && typeof current.restore === 'function') {
        current.restore();
    }
    return sandbox.stub(vscode.window, method as never) as unknown as sinon.SinonStub;
}

export function stubQuickPick<T>(returns: T): sinon.SinonStub {
    const stub = replaceStub('showQuickPick');
    return stub.resolves(returns as never);
}

export function stubInputBox(returns: string | undefined): sinon.SinonStub {
    const stub = replaceStub('showInputBox');
    return stub.resolves(returns as never);
}

export function stubInformation(): sinon.SinonStub {
    return replaceStub('showInformationMessage').resolves(undefined as never);
}

export function stubError(): sinon.SinonStub {
    return replaceStub('showErrorMessage').resolves(undefined as never);
}

export function stubWarning(): sinon.SinonStub {
    return replaceStub('showWarningMessage').resolves(undefined as never);
}

/**
 * Replace withProgress so the test can drive the cancellation token immediately.
 * `cancelAfterMs` schedules a cancel() on the token after the body starts.
 */
export function stubWithProgressCancellable(cancelAfterMs: number): sinon.SinonStub {
    return sandbox.stub(vscode.window, 'withProgress').callsFake(async (_options, task) => {
        const tokenSource = new vscode.CancellationTokenSource();
        const progress = { report: () => undefined };
        setTimeout(() => tokenSource.cancel(), cancelAfterMs);
        try {
            return await task(progress, tokenSource.token);
        } finally {
            tokenSource.dispose();
        }
    });
}

export function restoreStubs(): void {
    sandbox.restore();
    sandbox = sinon.createSandbox();
}
