import * as vscode from 'vscode';
import * as amplitude from '@amplitude/analytics-node';
import { Logger } from '../utils/logger';

const AMPLITUDE_API_KEY = process.env.AMPLITUDE_API_KEY || '';

export class TelemetryService {
    private static disposables: vscode.Disposable[] = [];
    private static enabled: boolean = true;

    static async initialize(context: vscode.ExtensionContext): Promise<void> {
        void Logger.log('Initializing telemetry service');

        if (!AMPLITUDE_API_KEY) {
            void Logger.error('Amplitude API key not found');
            return;
        }

        try {
            amplitude.init(AMPLITUDE_API_KEY, {
                serverZone: 'EU',
                flushQueueSize: 1,
                flushIntervalMillis: 0
            });
            void Logger.log('Amplitude service initialized');

        } catch (error) {
            void Logger.error('Failed to initialize Amplitude:', error as Error);
            return;
        }

        this.enabled = vscode.env.isTelemetryEnabled;

        this.disposables.push(
            vscode.env.onDidChangeTelemetryEnabled(enabled => {
                this.enabled = enabled;
                void Logger.log(`Telemetry enabled state changed to: ${enabled}`);
            })
        );

        context.subscriptions.push(...this.disposables);
        void Logger.log('Telemetry service initialized');
    }

    static sendEvent(eventName: string, properties?: Record<string, any>): void {
        if (!this.enabled) {
            void Logger.log('Telemetry disabled, skipping event');
            return;
        }

        try {
            void Logger.log(`Sending telemetry event: ${eventName}`);
            amplitude.track(eventName, {
                ...properties,
                vsCodeVersion: vscode.version,
                extensionVersion: vscode.extensions.getExtension('VizzleTF.geminicommit')?.packageJSON.version,
                platform: process.platform
            }, {
                device_id: vscode.env.machineId
            });
            void Logger.log(`Telemetry event sent successfully: ${eventName}`);
        } catch (error) {
            void Logger.error('Failed to send telemetry:', error as Error);
        }
    }

    static dispose(): void {
        this.disposables.forEach(d => void d.dispose());
        void Logger.log('Telemetry service disposed');
    }
}
