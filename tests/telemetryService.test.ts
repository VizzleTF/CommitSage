import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Amplitude SDK mock -----------------------------------------------------
const amplitudeInit = vi.fn();
const amplitudeSetOptOut = vi.fn();
const amplitudeTrack = vi.fn(() => ({ promise: Promise.resolve() }));
const amplitudeFlush = vi.fn(() => ({ promise: Promise.resolve() }));

vi.mock('@amplitude/analytics-node', () => ({
    init: (...a: unknown[]) => amplitudeInit(...a),
    setOptOut: (...a: unknown[]) => amplitudeSetOptOut(...a),
    track: (...a: unknown[]) => amplitudeTrack(...a),
    flush: (...a: unknown[]) => amplitudeFlush(...a),
}));

// --- Amplitude API key: controllable so we can hit the empty short-circuit ---
const apiKeyHolder = { value: 'real-key' as string };
vi.mock('../src/constants/apiKeys', () => ({
    get AMPLITUDE_API_KEY() {
        return apiKeyHolder.value;
    },
}));

// --- ConfigService ----------------------------------------------------------
const telemetryEnabled = { value: true };
let projectConfigListener: (() => void) | undefined;
vi.mock('../src/utils/configService', () => ({
    ConfigService: {
        get: (key: string) => {
            if (key === 'telemetry.enabled') {
                return telemetryEnabled.value;
            }
            return undefined;
        },
        knownConfigurationKeys: [
            'commitSage.telemetry.enabled',
            'commitSage.commit.autoCommit',
        ],
        onProjectConfigChange: (l: () => void) => {
            projectConfigListener = l;
            return { dispose: () => undefined };
        },
    },
}));

// --- vscode mock ------------------------------------------------------------
const logUsage = vi.fn();
const loggerDispose = vi.fn();
const createTelemetryLogger = vi.fn((sender: unknown, _options?: unknown) => {
    capturedSender = sender as {
        sendEventData: (n: string, d?: Record<string, unknown>) => void;
        sendErrorData: (e: Error, d?: Record<string, unknown>) => void;
    };
    return {
        logUsage,
        logError: vi.fn(),
        dispose: loggerDispose,
        onDidChangeEnableStates: () => ({ dispose: () => undefined }),
        isUsageEnabled: true,
        isErrorsEnabled: true,
    };
});

let capturedSender:
    | {
          sendEventData: (n: string, d?: Record<string, unknown>) => void;
          sendErrorData: (e: Error, d?: Record<string, unknown>) => void;
      }
    | undefined;
let configChangeListener: ((e: unknown) => void) | undefined;
// `inspect('telemetry.enabled')` result: user (global) and workspace levels.
const telemetryInspect: { globalValue?: boolean; workspaceValue?: boolean } = {};

vi.mock('vscode', () => ({
    version: '1.99.0',
    env: {
        machineId: 'mid',
        createTelemetryLogger: (...a: unknown[]) => createTelemetryLogger(a[0], a[1]),
    },
    workspace: {
        getConfiguration: () => ({ inspect: () => telemetryInspect }),
        onDidChangeConfiguration: (l: (e: unknown) => void) => {
            configChangeListener = l;
            return { dispose: () => undefined };
        },
    },
    window: {
        createOutputChannel: () => ({
            appendLine: () => undefined,
            append: () => undefined,
            show: () => undefined,
            dispose: () => undefined,
            trace: () => undefined,
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
            logLevel: 0,
            onDidChangeLogLevel: () => ({ dispose: () => undefined }),
        }),
    },
}));

import { TelemetryService } from '../src/services/telemetryService';

function makeContext(subscriptions: unknown[] = []): import('vscode').ExtensionContext {
    return {
        subscriptions,
        extension: { packageJSON: { version: '9.9.9' } },
    } as unknown as import('vscode').ExtensionContext;
}

beforeEach(() => {
    apiKeyHolder.value = 'real-key';
    telemetryEnabled.value = true;
    delete telemetryInspect.globalValue;
    delete telemetryInspect.workspaceValue;
    capturedSender = undefined;
    configChangeListener = undefined;
    amplitudeInit.mockClear();
    amplitudeSetOptOut.mockClear();
    amplitudeTrack.mockClear();
    amplitudeFlush.mockClear();
    logUsage.mockClear();
    loggerDispose.mockClear();
    createTelemetryLogger.mockClear();
    TelemetryService.dispose();
    amplitudeInit.mockImplementation(() => undefined);
    amplitudeFlush.mockImplementation(() => ({ promise: Promise.resolve() }));
});

afterEach(() => {
    TelemetryService.dispose();
});

describe('TelemetryService.initialize', () => {
    it('short-circuits when the Amplitude API key is missing', async () => {
        apiKeyHolder.value = '';
        const ctx = makeContext();
        await TelemetryService.initialize(ctx);
        expect(amplitudeInit).not.toHaveBeenCalled();
        // Not initialized -> sendEvent is a no-op.
        TelemetryService.sendEvent({ name: 'extension_activated' });
        expect(logUsage).not.toHaveBeenCalled();
    });

    it('initializes amplitude + the telemetry logger when the key is present', async () => {
        const subs: unknown[] = [];
        await TelemetryService.initialize(makeContext(subs));
        expect(amplitudeInit).toHaveBeenCalledWith(
            'real-key',
            expect.objectContaining({ serverZone: 'EU', optOut: false }),
        );
        expect(createTelemetryLogger).toHaveBeenCalled();
        // The config-change disposable was registered.
        expect(subs.length).toBeGreaterThan(0);
    });

    it('computes optOut=true when telemetry is disabled', async () => {
        telemetryEnabled.value = false;
        await TelemetryService.initialize(makeContext());
        expect(amplitudeInit).toHaveBeenCalledWith(
            'real-key',
            expect.objectContaining({ optOut: true }),
        );
    });

    // telemetryEnabled (ConfigService.get) stays true: the project or workspace value wins there.
    it.each([
        ['the project config', { globalValue: false }],
        ['the workspace settings', { globalValue: false, workspaceValue: true }],
    ])('keeps optOut when %s says true over a user false', async (_where, levels) => {
        Object.assign(telemetryInspect, levels);
        await TelemetryService.initialize(makeContext());
        expect(amplitudeInit).toHaveBeenCalledWith('real-key', expect.objectContaining({ optOut: true }));
    });

    it('lets the workspace opt out over a user true', async () => {
        Object.assign(telemetryInspect, { globalValue: true, workspaceValue: false });
        await TelemetryService.initialize(makeContext());
        expect(amplitudeInit).toHaveBeenCalledWith('real-key', expect.objectContaining({ optOut: true }));
    });

    it('marks itself not-initialized if amplitude.init throws', async () => {
        amplitudeInit.mockImplementationOnce(() => {
            throw new Error('init boom');
        });
        await TelemetryService.initialize(makeContext());
        TelemetryService.sendEvent({ name: 'extension_activated' });
        expect(logUsage).not.toHaveBeenCalled();
    });

    it('wraps a non-Error init throw via new Error(String(error))', async () => {
        // Throwing a non-Error value drives the `: new Error(String(error))`
        // branch of the catch coercion.
        amplitudeInit.mockImplementationOnce(() => {
            throw 'string failure';
        });
        await TelemetryService.initialize(makeContext());
        TelemetryService.sendEvent({ name: 'extension_activated' });
        expect(logUsage).not.toHaveBeenCalled();
    });
});

describe('TelemetryService.sendEvent', () => {
    it('drops the built-in common properties and adds only the documented ones', async () => {
        await TelemetryService.initialize(makeContext());
        expect(createTelemetryLogger).toHaveBeenCalledWith(expect.anything(), {
            ignoreBuiltInCommonProperties: true,
            additionalCommonProperties: {
                vsCodeVersion: '1.99.0',
                extensionVersion: '9.9.9',
                platform: process.platform,
            },
        });
    });

    it('forwards usage events without the event name in the payload', async () => {
        await TelemetryService.initialize(makeContext());
        TelemetryService.sendEvent({ name: 'push_completed' });
        expect(logUsage).toHaveBeenCalledWith('push_completed', {});
    });

    it('spreads extra event props into the payload', async () => {
        await TelemetryService.initialize(makeContext());
        TelemetryService.sendEvent({
            name: 'commit_completed',
            fileCount: 3,
            messageLength: 12,
        });
        expect(logUsage).toHaveBeenCalledWith(
            'commit_completed',
            expect.objectContaining({ fileCount: 3, messageLength: 12 }),
        );
    });

    it('is a no-op before initialize', () => {
        TelemetryService.sendEvent({ name: 'push_completed' });
        expect(logUsage).not.toHaveBeenCalled();
    });
});

describe('AmplitudeTelemetrySender (via the captured sender)', () => {
    it('sendEventData tracks the event through amplitude', async () => {
        await TelemetryService.initialize(makeContext());
        expect(capturedSender).toBeDefined();
        capturedSender!.sendEventData('my_event', { a: 1 });
        expect(amplitudeTrack).toHaveBeenCalledWith(
            'my_event',
            { a: 1 },
            expect.objectContaining({ device_id: 'mid' }),
        );
    });

    it('sendEventData defaults data to an empty object', async () => {
        await TelemetryService.initialize(makeContext());
        capturedSender!.sendEventData('bare');
        expect(amplitudeTrack).toHaveBeenCalledWith('bare', {}, expect.any(Object));
    });

    it('sendEventData logs when amplitude.track rejects', async () => {
        amplitudeTrack.mockImplementationOnce(() => ({
            promise: Promise.reject(new Error('track fail')),
        }));
        await TelemetryService.initialize(makeContext());
        capturedSender!.sendEventData('evt');
        // Allow the rejected promise's .catch to run.
        await Promise.resolve();
        await Promise.resolve();
        expect(amplitudeTrack).toHaveBeenCalled();
    });

    it('sendEventData handles a non-Error rejection', async () => {
        amplitudeTrack.mockImplementationOnce(() => ({
            promise: Promise.reject('string failure'),
        }));
        await TelemetryService.initialize(makeContext());
        capturedSender!.sendEventData('evt');
        await Promise.resolve();
        await Promise.resolve();
        expect(amplitudeTrack).toHaveBeenCalled();
    });

    it('sendErrorData sends the name, a category and the frames, never the message', async () => {
        await TelemetryService.initialize(makeContext());
        const err = new Error('Git command failed with code 1: hook printed const secret = 1\nsecond line');
        err.name = 'GitCommandError';
        err.stack = `${err.name}: ${err.message}\n    at run (/home/jane/ext/dist/extension.js:2:345)\n    at node:internal/process:1:1`;
        capturedSender!.sendErrorData(err, { foo: 'bar' });
        expect(amplitudeTrack).toHaveBeenCalledWith(
            'extension_error',
            {
                foo: 'bar',
                errorType: 'GitCommandError',
                errorCategory: 'git',
                errorStack: '    at run (<path>:2:345)\n    at node:internal/process:1:1',
            },
            expect.any(Object),
        );
    });

    it('sendErrorData omits errorStack when the error has no frames', async () => {
        await TelemetryService.initialize(makeContext());
        const err = new Error('kaboom');
        err.stack = undefined;
        capturedSender!.sendErrorData(err);
        expect(amplitudeTrack).toHaveBeenCalledWith(
            'extension_error',
            { errorType: 'Error', errorCategory: 'other', errorStack: undefined },
            expect.any(Object),
        );
    });

    it('sendErrorData honors a caller-supplied event name', async () => {
        await TelemetryService.initialize(makeContext());
        capturedSender!.sendErrorData(new Error('x'), { name: 'custom_error' });
        expect(amplitudeTrack).toHaveBeenCalledWith(
            'custom_error',
            expect.any(Object),
            expect.any(Object),
        );
    });
});

describe('TelemetryService.handleConfigChange (via the captured listener)', () => {
    function fireConfig(affected: string[]): void {
        configChangeListener?.({
            affectsConfiguration: (key: string) => affected.includes(key),
        });
    }

    it('ignores changes outside the commitSage namespace', async () => {
        await TelemetryService.initialize(makeContext());
        logUsage.mockClear();
        fireConfig(['someOtherExtension']);
        expect(amplitudeSetOptOut).not.toHaveBeenCalled();
        expect(logUsage).not.toHaveBeenCalled();
    });

    it('updates optOut and emits settings_changed when telemetry.enabled flips', async () => {
        await TelemetryService.initialize(makeContext());
        logUsage.mockClear();
        fireConfig(['commitSage', 'commitSage.telemetry.enabled']);
        expect(amplitudeSetOptOut).toHaveBeenCalled();
        expect(logUsage).toHaveBeenCalledWith(
            'settings_changed',
            expect.objectContaining({ setting: 'telemetry.enabled' }),
        );
    });

    it('attributes a non-telemetry setting change to its specific key', async () => {
        await TelemetryService.initialize(makeContext());
        logUsage.mockClear();
        fireConfig(['commitSage', 'commitSage.commit.autoCommit']);
        expect(logUsage).toHaveBeenCalledWith(
            'settings_changed',
            expect.objectContaining({ setting: 'commit.autoCommit' }),
        );
    });

    it('updates optOut when the project config changes telemetry.enabled', async () => {
        await TelemetryService.initialize(makeContext());
        amplitudeSetOptOut.mockClear();
        telemetryEnabled.value = false;
        projectConfigListener?.();
        expect(amplitudeSetOptOut).toHaveBeenCalledWith(true);
        telemetryEnabled.value = true;
        projectConfigListener?.();
        expect(amplitudeSetOptOut).toHaveBeenLastCalledWith(false);
    });

    it('falls back to the commitSage catch-all attribution', async () => {
        await TelemetryService.initialize(makeContext());
        logUsage.mockClear();
        // commitSage namespace affected, but no known specific key matches.
        fireConfig(['commitSage']);
        expect(logUsage).toHaveBeenCalledWith(
            'settings_changed',
            expect.objectContaining({ setting: 'commitSage' }),
        );
    });
});

describe('TelemetryService.flush', () => {
    it('is a no-op before initialize', async () => {
        await TelemetryService.flush();
        expect(amplitudeFlush).not.toHaveBeenCalled();
    });

    it('flushes amplitude when initialized', async () => {
        await TelemetryService.initialize(makeContext());
        await TelemetryService.flush();
        expect(amplitudeFlush).toHaveBeenCalled();
    });

    it('swallows flush errors', async () => {
        await TelemetryService.initialize(makeContext());
        amplitudeFlush.mockImplementationOnce(() => ({
            promise: Promise.reject(new Error('flush boom')),
        }));
        await expect(TelemetryService.flush()).resolves.toBeUndefined();
    });

    it('swallows a non-Error flush rejection', async () => {
        await TelemetryService.initialize(makeContext());
        amplitudeFlush.mockImplementationOnce(() => ({
            promise: Promise.reject('str'),
        }));
        await expect(TelemetryService.flush()).resolves.toBeUndefined();
    });
});

describe('TelemetryService.dispose', () => {
    it('disposes the logger, clears state, and is idempotent', async () => {
        await TelemetryService.initialize(makeContext());
        TelemetryService.dispose();
        expect(loggerDispose).toHaveBeenCalled();
        // After dispose, sendEvent is a no-op.
        TelemetryService.sendEvent({ name: 'push_completed' });
        expect(logUsage).not.toHaveBeenCalled();
        // Second dispose is safe.
        TelemetryService.dispose();
    });
});
