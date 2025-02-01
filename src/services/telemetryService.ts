/// <reference types="node" />
import * as vscode from 'vscode';
import * as amplitude from '@amplitude/analytics-node';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { AMPLITUDE_API_KEY } from '../constants/apiKeys';
import { EventOptions } from '@amplitude/analytics-types';

const TELEMETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    queueSizeLimit: 100,
    flushInterval: 30000,
} as const;

type TelemetryEventName =
    | 'extension_activated'
    | 'message_generation_started'
    | 'message_generation_completed'
    | 'message_generation_failed'
    | 'commit_started'
    | 'commit_completed'
    | 'commit_failed'
    | 'settings_changed'
    | 'generate_message_started';

interface TelemetryEventProperties {
    vsCodeVersion: string;
    extensionVersion: string | undefined;
    platform: string;
    [key: string]: unknown;
}

interface QueuedEvent {
    eventName: TelemetryEventName;
    properties: TelemetryEventProperties;
    retryCount: number;
    timestamp: number;
}

declare const setInterval: (callback: () => void, ms: number) => number;
declare const clearInterval: (intervalId: number) => void;
declare const process: { platform: string };

export class TelemetryService {
    private static disposables: vscode.Disposable[] = [];
    private static enabled: boolean = true;
    private static initialized: boolean = false;
    private static eventQueue: QueuedEvent[] = [];
    private static flushInterval: number | null = null;

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        void Logger.log('Initializing telemetry service');

        try {
            if (!AMPLITUDE_API_KEY) {
                void Logger.error('Amplitude API key not found');
                return;
            }

            amplitude.init(AMPLITUDE_API_KEY, {
                serverZone: 'EU',
                flushQueueSize: 1,
                flushIntervalMillis: 0,
                optOut: !this.enabled
            });

            this.initialized = true;
            void Logger.log('Amplitude service initialized successfully');

            this.enabled = vscode.env.isTelemetryEnabled && ConfigService.isTelemetryEnabled();

            this.disposables.push(
                vscode.env.onDidChangeTelemetryEnabled(this.handleTelemetryStateChange.bind(this)),
                vscode.workspace.onDidChangeConfiguration(this.handleConfigChange.bind(this))
            );

            this.startQueueProcessor();

            context.subscriptions.push(...this.disposables);
            void Logger.log('Telemetry service initialized');

            this.sendEvent('extension_activated');
        } catch (error) {
            void Logger.error('Failed to initialize Amplitude:', error as Error);
            this.initialized = false;
        }
    }

    static sendEvent(eventName: TelemetryEventName, customProperties: Record<string, unknown> = {}): void {
        if (!this.enabled) {
            void Logger.log('Telemetry disabled, skipping event');
            return;
        }

        const properties: TelemetryEventProperties = {
            vsCodeVersion: vscode.version,
            extensionVersion: vscode.extensions.getExtension('VizzleTF.commitsage')?.packageJSON.version,
            platform: process.platform,
            ...customProperties
        };

        const queuedEvent: QueuedEvent = {
            eventName,
            properties,
            retryCount: 0,
            timestamp: Date.now()
        };

        this.queueEvent(queuedEvent);
    }

    private static queueEvent(event: QueuedEvent): void {
        if (this.eventQueue.length >= TELEMETRY_CONFIG.queueSizeLimit) {
            this.eventQueue.shift();
            void Logger.warn('Telemetry event queue full, removing oldest event');
        }

        this.eventQueue.push(event);
        void Logger.log(`Event queued: ${event.eventName}`);

        if (this.initialized) {
            void this.processEventQueue();
        }
    }

    private static async processEventQueue(): Promise<void> {
        if (!this.initialized || !this.enabled || this.eventQueue.length === 0) {
            return;
        }

        const currentEvent = this.eventQueue[0];

        try {
            void Logger.log(`Processing telemetry event: ${currentEvent.eventName}`);

            /* eslint-disable @typescript-eslint/naming-convention */
            const options: EventOptions = {
                device_id: vscode.env.machineId,
                time: currentEvent.timestamp
            };
            /* eslint-enable @typescript-eslint/naming-convention */

            await amplitude.track(currentEvent.eventName, currentEvent.properties, options);

            this.eventQueue.shift();
            void Logger.log(`Telemetry event sent successfully: ${currentEvent.eventName}`);
        } catch (error) {
            void Logger.error('Failed to send telemetry:', error as Error);

            if (currentEvent.retryCount < TELEMETRY_CONFIG.maxRetries) {
                currentEvent.retryCount++;
                void Logger.log(`Retrying event ${currentEvent.eventName} (attempt ${currentEvent.retryCount}/${TELEMETRY_CONFIG.maxRetries})`);
                await this.delay(TELEMETRY_CONFIG.retryDelay * currentEvent.retryCount);
            } else {
                void Logger.error(`Failed to send event ${currentEvent.eventName} after ${TELEMETRY_CONFIG.maxRetries} attempts, discarding`);
                this.eventQueue.shift();
            }
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
        this.enabled = enabled;
        amplitude.setOptOut(!enabled);
        void Logger.log(`Telemetry enabled state changed to: ${enabled}`);
    }

    private static handleConfigChange(event: vscode.ConfigurationChangeEvent): void {
        if (event.affectsConfiguration('commitSage.telemetry.enabled')) {
            this.enabled = ConfigService.isTelemetryEnabled();
            amplitude.setOptOut(!this.enabled);
        }
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static dispose(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }

        if (this.eventQueue.length > 0) {
            void Logger.log(`Attempting to send ${this.eventQueue.length} remaining telemetry events`);
            void this.processEventQueue();
        }

        this.disposables.forEach(d => void d.dispose());
        this.initialized = false;
        void Logger.log('Telemetry service disposed');
    }
}
