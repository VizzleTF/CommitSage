import * as vscode from 'vscode';
import * as amplitude from '@amplitude/analytics-node';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { AMPLITUDE_API_KEY } from '../constants/apiKeys';
import { EventOptions } from '@amplitude/analytics-types';
import { EnvironmentUtils } from '../utils/environmentUtils';

const TELEMETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    queueSizeLimit: 100,
    flushInterval: 30000,
} as const;

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

interface QueuedEvent {
    eventName: string;
    properties: TelemetryEventProperties;
    retryCount: number;
    timestamp: number;
}

export class TelemetryService {
    private static disposables: vscode.Disposable[] = [];
    private static enabled: boolean = true;
    private static initialized: boolean = false;
    private static eventQueue: QueuedEvent[] = [];
    private static flushInterval: ReturnType<typeof setInterval> | null = null;
    private static isProcessing: boolean = false;
    private static extensionVersion: string | undefined;

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        Logger.log('Initializing telemetry service');

        try {
            if (!AMPLITUDE_API_KEY) {
                Logger.error('Amplitude API key not found');
                return;
            }

            this.enabled = vscode.env.isTelemetryEnabled && ConfigService.isTelemetryEnabled();
            this.extensionVersion = context.extension.packageJSON.version as string | undefined;

            amplitude.init(AMPLITUDE_API_KEY, {
                serverZone: 'EU',
                flushQueueSize: 1,
                flushIntervalMillis: 0,
                optOut: !this.enabled
            });

            this.initialized = true;
            Logger.log('Amplitude service initialized successfully');

            this.disposables.push(
                vscode.env.onDidChangeTelemetryEnabled(this.handleTelemetryStateChange.bind(this)),
                vscode.workspace.onDidChangeConfiguration(this.handleConfigChange.bind(this))
            );

            this.startQueueProcessor();

            context.subscriptions.push(...this.disposables);
            Logger.log('Telemetry service initialized');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            Logger.error('Failed to initialize Amplitude:', err);
            this.initialized = false;
        }
    }

    static sendEvent(event: TelemetryEvent): void {
        if (!this.enabled) {
            Logger.log('Telemetry disabled, skipping event');
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

        const queuedEvent: QueuedEvent = {
            eventName: name,
            properties,
            retryCount: 0,
            timestamp: Date.now()
        };

        this.queueEvent(queuedEvent);
    }

    private static queueEvent(event: QueuedEvent): void {
        if (this.eventQueue.length >= TELEMETRY_CONFIG.queueSizeLimit) {
            this.eventQueue.shift();
            Logger.warn('Telemetry event queue full, removing oldest event');
        }

        this.eventQueue.push(event);
        Logger.log(`Event queued: ${event.eventName}`);

        if (this.initialized) {
            void this.processEventQueue();
        }
    }

    private static async processEventQueue(): Promise<void> {
        if (!this.initialized || !this.enabled || this.eventQueue.length === 0 || this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        const currentEvent = this.eventQueue[0];

        try {
            Logger.log(`Processing telemetry event: ${currentEvent.eventName}`);

            /* eslint-disable @typescript-eslint/naming-convention */
            const options: EventOptions = {
                device_id: vscode.env.machineId,
                time: currentEvent.timestamp
            };
            /* eslint-enable @typescript-eslint/naming-convention */

            await amplitude.track(currentEvent.eventName, currentEvent.properties, options);

            this.eventQueue.shift();
            Logger.log(`Telemetry event sent successfully: ${currentEvent.eventName}`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            Logger.error('Failed to send telemetry:', err);

            if (currentEvent.retryCount < TELEMETRY_CONFIG.maxRetries) {
                currentEvent.retryCount++;
                Logger.log(`Retrying event ${currentEvent.eventName} (attempt ${currentEvent.retryCount}/${TELEMETRY_CONFIG.maxRetries})`);
                await this.delay(TELEMETRY_CONFIG.retryDelay * currentEvent.retryCount);
            } else {
                Logger.error(`Failed to send event ${currentEvent.eventName} after ${TELEMETRY_CONFIG.maxRetries} attempts, discarding`);
                this.eventQueue.shift();
            }
        } finally {
            this.isProcessing = false;
        }
    }

    private static startQueueProcessor(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }

        this.flushInterval = setInterval(() => {
            void this.processEventQueue();
        }, TELEMETRY_CONFIG.flushInterval);
    }

    private static handleTelemetryStateChange(enabled: boolean): void {
        this.enabled = enabled && ConfigService.isTelemetryEnabled();
        amplitude.setOptOut(!this.enabled);
        Logger.log(`Telemetry enabled state changed to: ${this.enabled}`);
    }

    private static handleConfigChange(event: vscode.ConfigurationChangeEvent): void {
        if (!event.affectsConfiguration('commitSage')) {
            return;
        }

        if (event.affectsConfiguration('commitSage.telemetry.enabled')) {
            this.enabled = vscode.env.isTelemetryEnabled && ConfigService.isTelemetryEnabled();
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

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async flush(): Promise<void> {
        if (!this.initialized || this.eventQueue.length === 0) {
            return;
        }

        Logger.log(`Flushing ${this.eventQueue.length} remaining telemetry events`);

        while (this.eventQueue.length > 0) {
            await this.processEventQueue();

            if (this.eventQueue.length > 0) {
                await this.delay(100);
            }
        }
    }

    static dispose(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }

        if (this.eventQueue.length > 0) {
            Logger.log(`Attempting to send ${this.eventQueue.length} remaining telemetry events`);
            void this.processEventQueue();
        }

        this.disposables.forEach(d => void d.dispose());
        this.initialized = false;
        Logger.log('Telemetry service disposed');
    }
}
