/**
 * Utility for checking VS Code environment compatibility
 */
export class EnvironmentUtils {
    /**
     * Check if running in Web VS Code (vs Desktop)
     */
    static isWebExtension(): boolean {
        return typeof process === 'undefined' || typeof process.platform === 'undefined';
    }

    /**
     * Check if Node.js APIs are available
     */
    static isNodeApiAvailable(): boolean {
        try {
            return typeof require !== 'undefined' &&
                typeof process !== 'undefined' &&
                typeof process.platform !== 'undefined';
        } catch {
            return false;
        }
    }

    /**
     * Get platform information safely
     */
    static getPlatform(): string {
        if (this.isNodeApiAvailable()) {
            return process.platform;
        }
        return 'web';
    }

    /**
     * Check if file system operations are available
     */
    static isFileSystemAvailable(): boolean {
        if (this.isWebExtension()) {
            return false;
        }

        try {
            require('fs');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if child process operations are available
     */
    static isChildProcessAvailable(): boolean {
        if (this.isWebExtension()) {
            return false;
        }

        try {
            require('child_process');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get environment type for logging/telemetry
     */
    static getEnvironmentType(): 'desktop' | 'web' {
        return this.isWebExtension() ? 'web' : 'desktop';
    }
} 