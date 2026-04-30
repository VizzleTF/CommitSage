import * as vscode from 'vscode';
import * as amplitude from '@amplitude/analytics-node';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { AMPLITUDE_API_KEY } from '../constants/apiKeys';
import { EventOptions } from '@amplitude/analytics-types';
import { EnvironmentUtils } from '../utils/environmentUtils';

const FLUSH_QUEUE_SIZE = 30;
const FLUSH_INTERVAL_MS = 30_000;

export type TelemetryEvent =
    | { name: 'extension_activated' }
    | { name: 'extension_deactivated' }
    | { name: 'message_generation_started'; diffSize: number; fileCount: number; truncated: boolean; provider: string }
    | { name: 'message_generation_completed'; provider: string; model: string; durationMs: number; language: string; onlyStagedChanges: boolean }
    | { name: 'message_generation_failed'; provider: string; error: string; errorType: string }
    | { name: 'commit_completed'; hasStaged: boolean; hasUntracked: boolean; hasDeleted: boolean; messageLength: number }
    | { name: 'commit_failed'; error: string; errorType: string }
    | { name: 'settings_changed'; setting: string }
    | { name: 'push_completed' }
    | { name: 'push_failed'; error: string; errorType: string };

interface TelemetryEventProperties {
    vsCodeVersion: string;
    extensionVersion: string | undefined;
    platform: string;
    environment: string;
    [key: string]: unknown;
}

export class TelemetryService {
    private static disposables: vscode.Disposable[] = [];
    private static enabled: boolean = true;
    private static initialized: boolean = false;
    private static extensionVersion: string | undefined;

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        Logger.log('Initializing telemetry service');

        try {
            if (!AMPLITUDE_API_KEY) {
                Logger.error('Amplitude API key not found');
                return;
            }

            this.enabled = vscode.env.isTelemetryEnabled && ConfigService.get('telemetry.enabled');
            this.extensionVersion = context.extension.packageJSON.version as string | undefined;

            // Let the SDK handle batching, retries, and the periodic flush.
            // We just call `track()` and `flush()` on shutdown.
            amplitude.init(AMPLITUDE_API_KEY, {
                serverZone: 'EU',
                flushQueueSize: FLUSH_QUEUE_SIZE,
                flushIntervalMillis: FLUSH_INTERVAL_MS,
                optOut: !this.enabled
            });

            this.initialized = true;
            Logger.log('Amplitude service initialized successfully');

            this.disposables.push(
                vscode.env.onDidChangeTelemetryEnabled(this.handleTelemetryStateChange.bind(this)),
                vscode.workspace.onDidChangeConfiguration(this.handleConfigChange.bind(this))
            );

            context.subscriptions.push(...this.disposables);
            Logger.log('Telemetry service initialized');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            Logger.error('Failed to initialize Amplitude:', err);
            this.initialized = false;
        }
    }

    static sendEvent(event: TelemetryEvent): void {
        if (!this.enabled || !this.initialized) {
            return;
        }

        const { name, ...eventProps } = event;

        const properties: TelemetryEventProperties = {
            vsCodeVersion: vscode.version,
            extensionVersion: this.extensionVersion,
            platform: EnvironmentUtils.getPlatform(),
            environment: EnvironmentUtils.getEnvironmentType(),
            ...eventProps
        };

        /* eslint-disable @typescript-eslint/naming-convention */
        const options: EventOptions = {
            device_id: vscode.env.machineId,
            time: Date.now()
        };
        /* eslint-enable @typescript-eslint/naming-convention */

        // Fire-and-forget. The SDK batches up to FLUSH_QUEUE_SIZE events
        // or flushes every FLUSH_INTERVAL_MS, whichever comes first, and
        // handles retries internally.
        void amplitude.track(name, properties, options).promise.catch((err: unknown) => {
            const e = err instanceof Error ? err : new Error(String(err));
            Logger.error('Failed to send telemetry:', e);
        });
    }

    private static handleTelemetryStateChange(enabled: boolean): void {
        this.enabled = enabled && ConfigService.get('telemetry.enabled');
        amplitude.setOptOut(!this.enabled);
        Logger.log(`Telemetry enabled state changed to: ${this.enabled}`);
    }

    private static handleConfigChange(event: vscode.ConfigurationChangeEvent): void {
        if (!event.affectsConfiguration('commitSage')) {
            return;
        }

        if (event.affectsConfiguration('commitSage.telemetry.enabled')) {
            this.enabled = vscode.env.isTelemetryEnabled && ConfigService.get('telemetry.enabled');
            amplitude.setOptOut(!this.enabled);
        }

        const knownKeys = [
            'commitSage.provider.type',
            'commitSage.commit.commitLanguage',
            'commitSage.commit.commitFormat',
            'commitSage.commit.onlyStagedChanges',
            'commitSage.commit.autoCommit',
            'commitSage.commit.autoPush',
            'commitSage.telemetry.enabled',
            'commitSage.gemini.model',
            'commitSage.openai.model',
            'commitSage.ollama.model',
            'commitSage.codestral.model',
        ];
        const changedKey = knownKeys.find(k => event.affectsConfiguration(k)) ?? 'commitSage';
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
        this.disposables.forEach(d => void d.dispose());
        this.initialized = false;
        Logger.log('Telemetry service disposed');
    }
}
