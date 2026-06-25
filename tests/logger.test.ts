import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { Logger } from '../src/utils/logger';

describe('Logger', () => {
    beforeEach(() => {
        Logger.dispose();
        vi.restoreAllMocks();
    });

    it('log/warn/error are no-ops before initialize', () => {
        // channel is null after dispose; these must not throw
        Logger.log('a');
        Logger.warn('b');
        Logger.error('c');
        Logger.error('c', new Error('x'));
        expect(true).toBe(true);
    });

    it('initialize creates a log output channel and logs to it', () => {
        const info = vi.fn();
        const warn = vi.fn();
        const error = vi.fn();
        const dispose = vi.fn();
        const channel = { info, warn, error, dispose };
        const spy = vi
            .spyOn(vscode.window, 'createOutputChannel')
            .mockReturnValue(channel as unknown as vscode.LogOutputChannel);

        Logger.initialize();
        expect(spy).toHaveBeenCalledWith('Commit Sage', { log: true });
        expect(info).toHaveBeenCalledWith('Logger initialized');

        Logger.log('hello');
        expect(info).toHaveBeenCalledWith('hello');

        Logger.warn('careful');
        expect(warn).toHaveBeenCalledWith('careful');

        Logger.error('bad');
        expect(error).toHaveBeenCalledWith('bad');

        const err = new Error('boom');
        Logger.error('bad with err', err);
        expect(error).toHaveBeenCalledWith('bad with err', err);

        Logger.dispose();
        expect(dispose).toHaveBeenCalled();
    });

    it('showError/showWarning/showInfo delegate to vscode prefixed', async () => {
        const errSpy = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('E' as never);
        const warnSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('W' as never);
        const infoSpy = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('I' as never);

        await expect(Logger.showError('oops', 'Retry')).resolves.toBe('E');
        expect(errSpy).toHaveBeenCalledWith('Commit Sage: oops', 'Retry');

        await expect(Logger.showWarning('warn')).resolves.toBe('W');
        expect(warnSpy).toHaveBeenCalledWith('Commit Sage: warn');

        await expect(Logger.showInfo('info')).resolves.toBe('I');
        expect(infoSpy).toHaveBeenCalledWith('Commit Sage: info');
    });

    it('dispose is safe when channel already null', () => {
        Logger.dispose();
        Logger.dispose();
        expect(true).toBe(true);
    });
});
