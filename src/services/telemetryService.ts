import * as vscode from 'vscode';
import * as amplitude from '@amplitude/analytics-node';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { AMPLITUDE_API_KEY } from '../constants/apiKeys';
import { EventOptions } from '@amplitude/analytics-types';

const FLUSH_QUEUE_SIZE = 30;
const FLUSH_INTERVAL_MS = 30_000;

type TelemetryEvent =
    | { name: 'extension_activated' }
    | { name: 'extension_deactivated' }
    | { name: 'message_generation_started'; diffSize: number; fileCount: number; truncated: boolean; provider: string; model: string }
    | { name: 'message_generation_completed'; provider: string; model: string; durationMs: number; language: string; onlyStagedChanges: boolean }
    | { name: 'message_generation_failed'; provider: string; model: string; error: string; errorType: string }
    | { name: 'commit_completed'; hasStaged: boolean; hasUntracked: boolean; hasDeleted: boolean; messageLength: number }
    | { name: 'commit_failed'; error: string; errorType: string }
    | { name: 'settings_changed'; setting: string }
    | { name: 'push_completed' }
    | { name: 'push_failed'; error: string; errorType: string };

interface TelemetryEventProperties {
    vsCodeVersion: string;
    extensionVersion: string | undefined;
    platform: string;
    [key: string]: unknown;
}

/**
 * Bridges VSCode's TelemetryLogger to Amplitude. The logger handles VSCode's
 * native telemetry gating (`isTelemetryEnabled`, per-extension toggle, PII
 * sanitization, telemetry output channel mirroring); this sender just forwards
 * the cleaned event payload to Amplitude's batched track API.
 */
class AmplitudeTelemetrySender implements vscode.TelemetrySender {
    sendEventData(eventName: string, data?: Record<string, unknown>): void {
        /* eslint-disable @typescript-eslint/naming-convention */
        const options: EventOptions = {
            device_id: vscode.env.machineId,
            time: Date.now(),
        };
        /* eslint-enable @typescript-eslint/naming-convention */

        void amplitude.track(eventName, data ?? {}, options).promise.catch((err: unknown) => {
            const e = err instanceof Error ? err : new Error(String(err));
            Logger.error('Failed to send telemetry:', e);
        });
    }

    sendErrorData(error: Error, data?: Record<string, unknown>): void {
        // Called by `TelemetryLogger.logError(error, data)`. Forward as-is so
        // `error.message` / `error.stack` arrive in Amplitude alongside any
        // caller-supplied properties (including `name` if the caller wants
        // a specific event name; otherwise default to 'extension_error').
        const eventName = typeof data?.name === 'string' ? data.name : 'extension_error';
        this.sendEventData(eventName, {
            ...data,
            errorMessage: error.message,
            errorStack: error.stack,
        });
    }
}

export class TelemetryService {
    private static disposables: vscode.Disposable[] = [];
    private static logger: vscode.TelemetryLogger | null = null;
    private static initialized: boolean = false;
    private static extensionVersion: string | undefined;

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        Logger.log('Initializing telemetry service');

        try {
            if (!AMPLITUDE_API_KEY) {
                Logger.error('Amplitude API key not found');
                return;
            }

            this.extensionVersion = context.extension.packageJSON.version as string | undefined;

            // Amplitude SDK handles batching/retry/periodic flush. We `track()`
            // and `flush()` on shutdown.
            amplitude.init(AMPLITUDE_API_KEY, {
                serverZone: 'EU',
                flushQueueSize: FLUSH_QUEUE_SIZE,
                flushIntervalMillis: FLUSH_INTERVAL_MS,
                // optOut is driven by the TelemetryLogger gate — see
                // syncOptOut() below for the extension-level toggle.
                optOut: !this.computeEnabled(),
            });

            // VSCode's TelemetryLogger natively respects `isTelemetryEnabled`
            // and the user's per-extension toggle, mirrors events into the
            // telemetry output channel for transparency, and sanitizes PII.
            this.logger = vscode.env.createTelemetryLogger(new AmplitudeTelemetrySender());

            this.initialized = true;
            Logger.log('Telemetry service initialized');

            // Our `commitSage.telemetry.enabled` extension-level toggle still
            // needs to drive Amplitude's optOut — VSCode's logger gates send
            // calls but does not propagate to the underlying SDK.
            this.disposables.push(
                vscode.workspace.onDidChangeConfiguration(this.handleConfigChange.bind(this)),
            );

            context.subscriptions.push(...this.disposables);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            Logger.error('Failed to initialize telemetry:', err);
            this.initialized = false;
        }
    }

    private static computeEnabled(): boolean {
        return vscode.env.isTelemetryEnabled && ConfigService.get('telemetry.enabled');
    }

    static sendEvent(event: TelemetryEvent): void {
        if (!this.initialized || !this.logger) {
            return;
        }

        const { name, ...eventProps } = event;

        const properties: TelemetryEventProperties = {
            vsCodeVersion: vscode.version,
            extensionVersion: this.extensionVersion,
            platform: process.platform,
            ...eventProps,
        };

        this.logger.logUsage(name, properties);
    }

    private static handleConfigChange(event: vscode.ConfigurationChangeEvent): void {
        if (!event.affectsConfiguration('commitSage')) {
            return;
        }

        if (event.affectsConfiguration('commitSage.telemetry.enabled')) {
            amplitude.setOptOut(!this.computeEnabled());
        }

        // Derive the candidate keys from SETTING_DEFAULTS so adding a new
        // setting requires only one edit (the schema). Falls back to the
        // catch-all 'commitSage' attribution if no specific key matches.
        const changedKey =
            ConfigService.knownConfigurationKeys.find(k =>
                event.affectsConfiguration(k),
            ) ?? 'commitSage';
        this.sendEvent({ name: 'settings_changed', setting: changedKey.replace('commitSage.', '') });
    }

    static async flush(): Promise<void> {
        if (!this.initialized) {
            return;
        }
        try {
            await amplitude.flush().promise;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            Logger.error('Telemetry flush failed:', err);
        }
    }

    static dispose(): void {
        this.disposables.forEach(d => { d.dispose(); });
        this.disposables = [];
        this.logger?.dispose();
        this.logger = null;
        this.initialized = false;
        Logger.log('Telemetry service disposed');
    }
}
