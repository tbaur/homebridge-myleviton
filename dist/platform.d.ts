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
     * Checks if accessory already exists
     */
    private accessoryExists;
    /**
     * Adds a new accessory
     */
    addAccessory(device: DeviceInfo, token: string): Promise<void>;
    /**
     * Configures a cached accessory
     */
    configureAccessory(accessory: PlatformAccessory): Promise<void>;
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
     * Creates a power getter handler
     */
    private createPowerGetter;
    /**
     * Creates a power setter handler
     */
    private createPowerSetter;
    /**
     * Creates a brightness getter handler
     * @param device - Device info
     * @param minValue - Minimum brightness value (0 for fans, 1 for dimmers)
     */
    private createBrightnessGetter;
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