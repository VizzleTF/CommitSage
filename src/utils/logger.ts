import * as vscode from 'vscode';
import { redactApiSecrets } from './errorUtils';

export class Logger {
    private static channel: vscode.LogOutputChannel | null = null;

    /**
     * Live API keys/tokens, registered by `ApiKeyManager` as they are read.
     * Provider error bodies are logged verbatim (they carry the actionable
     * detail), and some providers echo the offending key back inside them —
     * so the exact secret is scrubbed from anything that reaches the output
     * channel or an error dialog. Never persisted; cleared with the key.
     */
    private static readonly secrets = new Set<string>();

    /** Register a value that must never show up in the log. */
    static registerSecret(value: string | undefined): void {
        // Short values would match too much unrelated text; no real key is
        // that short anyway.
        if (value && value.length >= 8) {
            this.secrets.add(value);
        }
    }

    /** Drop a value from the redaction set (key removed / replaced). */
    static forgetSecret(value: string | undefined): void {
        if (value) {
            this.secrets.delete(value);
        }
    }

    private static redact(text: string): string {
        let result = redactApiSecrets(text);
        for (const secret of this.secrets) {
            result = result.replaceAll(secret, '<redacted>');
        }
        return result;
    }

    /** A copy of `error` with its message and stack scrubbed. */
    private static redactError(error: Error): Error {
        const copy = new Error(this.redact(error.message));
        copy.name = error.name;
        copy.stack = error.stack ? this.redact(error.stack) : undefined;
        return copy;
    }

    static initialize(): void {
        this.channel = vscode.window.createOutputChannel('Commit Sage', { log: true });
        this.channel.info('Logger initialized');
    }

    static log(message: string): void {
        this.channel?.info(this.redact(message));
    }

    static warn(message: string): void {
        this.channel?.warn(this.redact(message));
    }

    static error(message: string, error?: Error): void {
        if (!this.channel) { return; }
        if (error) {
            this.channel.error(this.redact(message), this.redactError(error));
        } else {
            this.channel.error(this.redact(message));
        }
    }

    static async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showErrorMessage(`Commit Sage: ${this.redact(message)}`, ...actions);
    }

    static async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showWarningMessage(`Commit Sage: ${message}`, ...actions);
    }

    static async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return await vscode.window.showInformationMessage(`Commit Sage: ${message}`, ...actions);
    }

    static dispose(): void {
        this.channel?.dispose();
        this.channel = null;
        this.secrets.clear();
    }
}
