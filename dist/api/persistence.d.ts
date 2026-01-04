/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Device state persistence for faster startup and offline resilience
 */
import type { PersistedDeviceState, DeviceStatus } from '../types';
/**
 * Persistence configuration
 */
export interface PersistenceConfig {
    /** Storage file path */
    storagePath: string;
    /** Maximum age of cached data in ms */
    maxAge: number;
    /** Maximum number of devices to persist */
    maxDevices: number;
}
/**
 * Default persistence configuration
 */
export declare const DEFAULT_PERSISTENCE_CONFIG: Partial<PersistenceConfig>;
/**
 * Default persistence file name
 */
export declare const PERSISTENCE_FILE_NAME = ".homebridge-myleviton-state.json";
/**
 * Device state persistence manager
 * Stores device states for faster startup and offline resilience
 */
export declare class DevicePersistence {
    private readonly storagePath;
    private readonly maxAge;
    private readonly maxDevices;
    private deviceStates;
    private loaded;
    private dirty;
    constructor(storagePath?: string, config?: Partial<PersistenceConfig>);
    /**
     * Load persisted device states from disk
     */
    load(): Map<string, PersistedDeviceState>;
    /**
     * Save device states to disk
     */
    save(): boolean;
    /**
     * Update state for a device
     */
    updateDevice(deviceId: string, state: Partial<PersistedDeviceState>): void;
    /**
     * Update device from API status
     */
    updateFromStatus(deviceId: string, status: DeviceStatus): void;
    /**
     * Get cached state for a device
     */
    getDevice(deviceId: string): PersistedDeviceState | null;
    /**
     * Check if device has fresh cached data
     */
    hasFreshCache(deviceId: string, maxAge?: number): boolean;
    /**
     * Get device status from cache (for fallback)
     */
    getCachedStatus(deviceId: string): DeviceStatus | null;
    /**
     * Remove a device from persistence
     */
    removeDevice(deviceId: string): boolean;
    /**
     * Clear all persisted states
     */
    clear(): void;
    /**
     * Get all cached device states
     */
    getAllDevices(): Map<string, PersistedDeviceState>;
    /**
     * Get device count
     */
    get size(): number;
    /**
     * Check if persistence has been modified
     */
    get isDirty(): boolean;
    /**
     * Get persistence statistics
     */
    getStats(): {
        deviceCount: number;
        loaded: boolean;
        dirty: boolean;
        storagePath: string;
    };
}
/**
 * Get or create the global persistence instance
 */
export declare function getDevicePersistence(storagePath?: string): DevicePersistence;
/**
 * Reset the global persistence (for testing)
 */
export declare function resetGlobalPersistence(): void;
//# sourceMappingURL=persistence.d.ts.map