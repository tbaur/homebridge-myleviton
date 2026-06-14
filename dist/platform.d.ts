/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge platform plugin for My Leviton Decora Smart devices
 */
import type { LevitonConfig, DeviceInfo } from './types';
import type { HomebridgeAPI, PlatformAccessory } from './types/hap';
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
    private lastRefreshFailureAt;
    private webSocket;
    private pollingInterval;
    private isPolling;
    private residenceId;
    private devicePersistence;
    private initRetryTimer;
    private initAttempt;
    private isShuttingDown;
    private connectivityService;
    private isCloudOnline;
    private recentHomeKitCommands;
    private readonly diagnostics;
    private diagnosticsTimer;
    private lastDiagnosticsHealth;
    private lastTokenRefreshAt;
    private lastCloudDeviceCount;
    private lastStatelessCount;
    private lastExcludedCount;
    private wsHasDisconnected;
    private discoveryComplete;
    private wsPushConnected;
    private lastRestReachabilityAt;
    constructor(homebridgeLog: (msg: string) => void, config: LevitonConfig, api: HomebridgeAPI);
    /**
     * Validates plugin configuration using comprehensive schema validation
     */
    private validateConfig;
    /**
     * Initializes the platform, retrying on transient failures so a temporary
     * outage at startup doesn't leave the plugin permanently inert.
     */
    private initialize;
    /**
     * Schedules a delayed re-initialization attempt unless the platform is
     * shutting down. Only one retry is ever queued at a time.
     */
    private scheduleInitializeRetry;
    /**
     * Performs device discovery and accessory setup. Throws on failure so the
     * caller can decide whether to retry.
     */
    private discoverAndSetup;
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
    addAccessory(device: DeviceInfo): Promise<void>;
    /**
     * Creates (or removes) the optional cloud-connectivity status sensor.
     *
     * Exposed as a HomeKit ContactSensor: "contact detected" means the plugin can
     * reach the Leviton cloud, "contact not detected" means it cannot — so users
     * can build automations or notifications on loss of connectivity. The state is
     * driven by the WebSocket connection callback and the polling heartbeat.
     */
    private setupConnectivitySensor;
    /**
     * Reflects the latest cloud-connectivity state on the status sensor.
     * No-op when the sensor is disabled.
     */
    private updateConnectivity;
    /**
     * Gets a HAP-valid name while keeping the Leviton device name as the source.
     */
    private getHapDeviceName;
    /**
     * Updates an accessory's display name on both the PlatformAccessory wrapper
     * and the underlying HAP Accessory. Homebridge serializes the wrapper field
     * but the HAP Accessory.displayName is what HAP-NodeJS validates at construction
     * during cache deserialization, so both must stay in sync.
     */
    private updateAccessoryDisplayName;
    /**
     * Sanitizes the `displayName` field on every service attached to an accessory.
     *
     * Why this matters: HAP-NodeJS's `Service.deserialize` reconstructs a service
     * with `new Constructor(json.displayName, json.subtype)`, and the `Service`
     * constructor calls `checkName(this.displayName, "Name", displayName)` whenever
     * the displayName is non-empty. That warning has the same format as the
     * `Accessory` constructor's warning, so cleaning only the accessory's
     * displayName is not sufficient — the cached `services[i].displayName` field
     * must also be sanitized so the next deserialize cycle is silent.
     */
    private normalizeServiceDisplayNames;
    /**
     * Keeps cached Homebridge metadata aligned with the latest Leviton device record.
     * Also normalizes every service's `displayName` field, since that value is what
     * HAP-NodeJS validates during cache deserialization on subsequent restarts.
     */
    private syncAccessoryMetadata;
    /**
     * Configures a cached accessory.
     *
     * IMPORTANT: This must be synchronous. Homebridge calls this for each cached
     * accessory and does NOT await the result. If this were async with awaits,
     * the accessories array would be incomplete when didFinishLaunching fires,
     * causing race conditions where devices are incorrectly added as "new".
     *
     * Service setup is deferred to initialize() after deduplication.
     *
     * Cache name normalization: the HAP-NodeJS warning about invalid 'Name'
     * characteristics is emitted by the Accessory constructor at cache deserialize
     * time (see HAP-NodeJS Accessory.ts checkName() call in the constructor),
     * which runs *before* this hook. We can't suppress the very first warning, but
     * by sanitizing every cached field that feeds the next deserialize cycle and
     * persisting the cache via api.updatePlatformAccessories() synchronously here,
     * subsequent restarts will see clean names and emit no warning.
     */
    configureAccessory(accessory: PlatformAccessory): void;
    /**
     * Sanitizes every name surface on a cached accessory and persists the cache
     * file synchronously so the next restart loads HAP-valid values.
     *
     * Three independent fields can carry stale invalid characters into a fresh
     * deserialize cycle and trigger HAP-NodeJS warnings:
     *   1. `accessory.displayName` (Accessory constructor checkName)
     *   2. `service.displayName` for each service (Service constructor checkName)
     *   3. `context.device.name` (read by initialize() on subsequent runs)
     * All three must be normalized before flushing.
     */
    private normalizeCachedAccessoryNames;
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
     * Removes an accessory from Homebridge cache and local tracking
     */
    private removeCachedAccessory;
    /**
     * Sets up the appropriate service for a device
     */
    private setupService;
    /**
     * Gets device status with error handling
     */
    private getStatus;
    /**
     * Captures the current HomeKit state before reconfiguring a cached accessory.
     */
    private getCurrentServiceStatus;
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
    private getServiceByNameOrType;
    private syncServiceName;
    private syncExistingServiceNames;
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
     * Combines WebSocket push and REST poll signals for the connectivity sensor.
     * Online when WS is connected or a poll succeeded within two poll intervals.
     */
    private recomputeCloudConnectivity;
    /**
     * Prunes stale HomeKit command timestamps to prevent unbounded map growth.
     */
    private pruneRecentHomeKitCommands;
    /**
     * Saves device states to persistence
     */
    private saveDeviceStates;
    /**
     * Cleans up resources
     */
    private cleanup;
    /**
     * Records a rate-limit rejection on the diagnostics collector when a write
     * was throttled client-side (HTTP 429 from the rate limiter).
     */
    private recordThrottleIfRateLimited;
    /**
     * Handles WebSocket connection-state changes: drives the connectivity sensor
     * and counts reconnections (a recovery after a prior disconnect) for diagnostics.
     */
    private handleWsConnectionChange;
    /**
     * Diagnostics heartbeat interval in milliseconds (0 when disabled).
     */
    private diagnosticsIntervalMs;
    /**
     * Effective polling cadence in seconds (mirrors startPolling's clamping).
     */
    private pollingCadenceSeconds;
    /**
     * Starts the diagnostics subsystem: emits the boot snapshot and schedules the
     * heartbeat. No-op unless diagnosticsInterval > 0.
     */
    private startDiagnostics;
    /**
     * Emits a single heartbeat (per-interval deltas) and logs health transitions.
     * Wrapped so a reader failure can never escape the timer and crash Homebridge.
     */
    private diagnosticsHeartbeat;
    /**
     * Builds the synchronous, in-memory readers the collector uses. Never performs
     * network I/O.
     */
    private buildDiagnosticsReaders;
    /**
     * Computes absolute device gauges from the current accessories (the optional
     * connectivity sensor and stateless controllers are excluded).
     */
    private collectDeviceGauges;
    /**
     * Returns the primary controllable service for an accessory, if any.
     */
    private getPrimaryService;
    /**
     * Emits a diagnostics report as a human-readable line plus structured JSON
     * fields (when structuredLogs is enabled). The report is already redacted.
     */
    private emitDiagnostic;
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