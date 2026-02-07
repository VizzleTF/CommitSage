import * as vscode from 'vscode';
import * as amplitude from '@amplitude/analytics-node';
import { Logger } from '../utils/logger';
import { ConfigService } from '../utils/configService';
import { AMPLITUDE_API_KEY } from '../constants/apiKeys';
import { EventOptions } from '@amplitude/analytics-types';
import { EnvironmentUtils } from '../utils/environmentUtils';
import { toError } from '../utils/errorUtils';

const TELEMETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 1000,
    queueSizeLimit: 100,
    flushInterval: 30000,
} as const;

type TelemetryEventName =
    | 'extension_activated'
    | 'extension_deactivated'
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

export class TelemetryService {
    private static disposables: vscode.Disposable[] = [];
    private static enabled: boolean = true;
    private static initialized: boolean = false;
    private static eventQueue: QueuedEvent[] = [];
    private static flushInterval: ReturnType<typeof setInterval> | null = null;

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        Logger.log('Initializing telemetry service');

        try {
            if (!AMPLITUDE_API_KEY) {
                Logger.error('Amplitude API key not found');
                return;
            }

            amplitude.init(AMPLITUDE_API_KEY, {
                serverZone: 'EU',
                flushQueueSize: 1,
                flushIntervalMillis: 0,
                optOut: !this.enabled
            });

            this.initialized = true;
            Logger.log('Amplitude service initialized successfully');

            this.enabled = vscode.env.isTelemetryEnabled && ConfigService.isTelemetryEnabled();

            this.disposables.push(
                vscode.env.onDidChangeTelemetryEnabled(this.handleTelemetryStateChange.bind(this)),
                vscode.workspace.onDidChangeConfiguration(this.handleConfigChange.bind(this))
            );

            this.startQueueProcessor();

            context.subscriptions.push(...this.disposables);
            Logger.log('Telemetry service initialized');

            this.sendEvent('extension_activated');
        } catch (error) {
            Logger.error('Failed to initialize Amplitude:', toError(error));
            this.initialized = false;
        }
    }

    static sendEvent(eventName: TelemetryEventName, customProperties: Record<string, unknown> = {}): void {
        if (!this.enabled) {
            Logger.log('Telemetry disabled, skipping event');
            return;
        }

        const properties: TelemetryEventProperties = {
            vsCodeVersion: vscode.version,
            extensionVersion: vscode.extensions.getExtension('VizzleTF.commitsage')?.packageJSON.version,
            platform: EnvironmentUtils.getPlatform(),
            environment: EnvironmentUtils.getEnvironmentType(),
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
            Logger.warn('Telemetry event queue full, removing oldest event');
        }

        this.eventQueue.push(event);
        Logger.log(`Event queued: ${event.eventName}`);

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
            Logger.error('Failed to send telemetry:', toError(error));

            if (currentEvent.retryCount < TELEMETRY_CONFIG.maxRetries) {
                currentEvent.retryCount++;
                Logger.log(`Retrying event ${currentEvent.eventName} (attempt ${currentEvent.retryCount}/${TELEMETRY_CONFIG.maxRetries})`);
                await this.delay(TELEMETRY_CONFIG.retryDelay * currentEvent.retryCount);
            } else {
                Logger.error(`Failed to send event ${currentEvent.eventName} after ${TELEMETRY_CONFIG.maxRetries} attempts, discarding`);
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
        Logger.log(`Telemetry enabled state changed to: ${enabled}`);
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

    /**
     * Flush remaining events in the queue
     */
    static async flush(): Promise<void> {
        if (!this.initialized || this.eventQueue.length === 0) {
            return;
        }

        Logger.log(`Flushing ${this.eventQueue.length} remaining telemetry events`);

        // Process all remaining events
        while (this.eventQueue.length > 0) {
            await this.processEventQueue();

            // Prevent infinite loops
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
