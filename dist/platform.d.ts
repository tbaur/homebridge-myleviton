/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge platform plugin for My Leviton Decora Smart devices
 */
import type { LevitonConfig, DeviceInfo } from './types';
type HomebridgeAPI = any;
type PlatformAccessory = any;
/**
 * Leviton Decora Smart Platform for Homebridge
 */
export declare class LevitonDecoraSmartPlatform {
    private readonly config;
    private readonly api;
    private readonly accessories;
    private readonly log;
    private client;
    private currentLoginResponse;
    private tokenExpiresAt;
    private tokenRefreshPromise;
    private webSocket;
    private pollingInterval;
    private residenceId;
    private devicePersistence;
    private cleanupInterval;
    private recentHomeKitCommands;
    constructor(homebridgeLog: (msg: string) => void, config: LevitonConfig, api: HomebridgeAPI);
    /**
     * Validates plugin configuration using comprehensive schema validation
     */
    private validateConfig;
    /**
     * Initializes the platform
     */
    private initialize;
    /**
     * Discovers devices from Leviton API
     */
    private discoverDevices;
    /**
     * Handles WebSocket update messages
     */
    private handleWebSocketUpdate;
    /**
     * Checks if device should be excluded
     */
    private isDeviceExcluded;
    /**
     * Adds a new accessory
     */
    addAccessory(device: DeviceInfo, token: string): Promise<void>;
    /**
     * Configures a cached accessory
     *
     * IMPORTANT: This must be synchronous. Homebridge calls this for each cached
     * accessory and does NOT await the result. If this were async with awaits,
     * the accessories array would be incomplete when didFinishLaunching fires,
     * causing race conditions where devices are incorrectly added as "new".
     *
     * Service setup is deferred to initialize() after deduplication.
     */
    configureAccessory(accessory: PlatformAccessory): void;
    /**
     * Removes duplicate cache entries (same UUID appearing multiple times)
     *
     * This is a defensive cleanup that runs on every startup. Duplicates can occur
     * due to race conditions in older versions or cache file corruption. Since
     * duplicates share the same UUID, HomeKit only sees one accessory - removing
     * the extra cache entries has no user-visible effect.
     *
     * @returns Number of duplicate entries removed
     */
    private deduplicateAccessories;
    /**
     * Finds a cached accessory matching the given device by serial number
     * Uses case-insensitive comparison for robustness
     */
    private findAccessoryByDevice;
    /**
     * Sets up the appropriate service for a device
     */
    private setupService;
    /**
     * Gets device status with error handling
     */
    private getStatus;
    /**
     * Sets up a lightbulb service
     * @returns The device status used for initialization (allows callers to reuse it)
     */
    private setupLightbulbService;
    /**
     * Sets up a motion dimmer service
     */
    private setupMotionDimmerService;
    /**
     * Sets up a fan service
     */
    private setupFanService;
    /**
     * Sets up a basic switch/outlet service
     */
    private setupBasicService;
    /**
     * Creates a power setter handler
     */
    private createPowerSetter;
    /**
     * Creates a brightness setter handler
     */
    private createBrightnessSetter;
    /**
     * Store login response and compute token expiry
     */
    private setLoginResponse;
    /**
     * Check if the token is close to expiring
     */
    private isTokenExpiringSoon;
    /**
     * Retry once on authentication errors
     */
    private withTokenRetry;
    /**
     * Ensures a valid token is available
     */
    private ensureValidToken;
    /**
     * Refreshes the authentication token
     */
    private refreshToken;
    /**
     * Starts polling for device updates
     */
    private startPolling;
    /**
     * Polls all devices for updates
     *
     * This is a fallback mechanism when WebSocket updates are unavailable.
     * Fetches actual device status from the API for each accessory.
     *
     * IMPORTANT: On API failure, we preserve current HomeKit state rather than
     * updating with fallback values. This prevents incorrect state during outages.
     */
    private pollDevices;
    /**
     * Saves device states to persistence
     */
    private saveDeviceStates;
    /**
     * Starts periodic cleanup
     */
    private startPeriodicCleanup;
    /**
     * Cleans up resources
     */
    private cleanup;
    /**
     * Removes all accessories
     */
    removeAccessories(): void;
}
/**
 * Homebridge plugin registration
 */
export declare function registerPlatform(homebridge: HomebridgeAPI): void;
export default registerPlatform;
//# sourceMappingURL=platform.d.ts.map