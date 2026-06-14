"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge platform plugin for My Leviton Decora Smart devices
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LevitonDecoraSmartPlatform = void 0;
exports.registerPlatform = registerPlatform;
const path = __importStar(require("path"));
const client_1 = require("./api/client");
const websocket_1 = require("./api/websocket");
const persistence_1 = require("./api/persistence");
const collector_1 = require("./diagnostics/collector");
const logger_1 = require("./utils/logger");
const sanitizers_1 = require("./utils/sanitizers");
const validators_1 = require("./utils/validators");
const errors_1 = require("./errors");
const device_models_1 = require("./platform/device-models");
/**
 * Installed plugin version, used for diagnostics lifecycle reporting.
 *
 * Resolved once via `require` rather than a static `import`: `package.json`
 * lives outside the TypeScript `rootDir` (`src/`), so importing it would alter
 * the emitted `dist/` layout. The require resolves correctly from both the
 * compiled `dist/` output and ts-jest.
 */
function readPluginVersion() {
    try {
        return require('../package.json').version || 'unknown';
    }
    catch {
        return 'unknown';
    }
}
const PLUGIN_VERSION = readPluginVersion();
// Plugin constants
const PLUGIN_NAME = 'homebridge-myleviton';
const PLATFORM_NAME = 'MyLevitonDecoraSmart';
const UUID_PREFIX = 'myleviton-';
// Power states
const POWER_ON = 'ON';
const POWER_OFF = 'OFF';
// Token refresh buffer (refresh a few minutes before expiry)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_FAILURE_COOLDOWN_MS = 10 * 1000;
const POLL_DEVICE_CONCURRENCY = 4;
// Self-healing startup: if initial device discovery fails (e.g. a transient
// Leviton/network outage at boot), retry with exponential backoff instead of
// leaving the plugin permanently dead until a manual Homebridge restart.
const INITIAL_INIT_RETRY_MS = 15 * 1000;
const MAX_INIT_RETRY_MS = 5 * 60 * 1000;
const MAX_INIT_ATTEMPTS = 30;
/** Fallback TTL when the login response omits `ttl` (seconds). */
const DEFAULT_TOKEN_TTL_SEC = 3600;
const RECENT_HOMEKIT_COMMAND_TTL_MS = 60_000;
// Optional cloud-connectivity status sensor
const CONNECTIVITY_UUID_SEED = UUID_PREFIX + 'connectivity';
const DEFAULT_CONNECTIVITY_NAME = 'Leviton Cloud';
let hap;
/**
 * Leviton Decora Smart Platform for Homebridge
 */
class LevitonDecoraSmartPlatform {
    config;
    api;
    accessories = [];
    log;
    // API client
    client;
    // Token management
    currentLoginResponse = null;
    tokenExpiresAt = null;
    tokenRefreshPromise = null;
    lastRefreshFailureAt = null;
    // WebSocket connection
    webSocket = null;
    // Polling
    pollingInterval = null;
    isPolling = false;
    residenceId = null;
    // Device persistence
    devicePersistence;
    // Startup retry
    initRetryTimer = null;
    initAttempt = 0;
    isShuttingDown = false;
    // Optional cloud-connectivity status sensor
    connectivityService = null;
    isCloudOnline = true;
    // Track recent HomeKit commands to avoid logging them as "external"
    recentHomeKitCommands = new Map();
    // Opt-in diagnostics subsystem (off unless diagnosticsInterval > 0)
    diagnostics;
    diagnosticsTimer = null;
    lastDiagnosticsHealth = null;
    lastTokenRefreshAt = null;
    lastCloudDeviceCount = 0;
    lastStatelessCount = 0;
    lastExcludedCount = 0;
    wsHasDisconnected = false;
    discoveryComplete = false;
    wsPushConnected = false;
    lastRestReachabilityAt = null;
    constructor(homebridgeLog, config, api) {
        this.config = config;
        this.api = api;
        // Setup logging with optional structured JSON output
        this.log = (0, logger_1.createStructuredLogger)(homebridgeLog, {
            structured: config?.structuredLogs || false,
            level: config?.loglevel || 'info',
        });
        // Diagnostics collector is created before the client so the client's metrics
        // hook can feed it. Counters always accumulate (cheap, in-memory); reports
        // are only emitted when diagnosticsInterval > 0.
        this.diagnostics = new collector_1.DiagnosticsCollector({
            pluginVersion: PLUGIN_VERSION,
            config: config ?? {},
        });
        // Setup API client. Each platform instance owns its own client (and thus its
        // own circuit breaker, rate limiter, and cache) so multiple configured
        // accounts don't share resilience state and trip each other.
        this.client = new client_1.LevitonApiClient({
            timeout: config?.connectionTimeout || 10000,
            logger: {
                debug: (msg) => this.log.debug(msg),
                info: (msg) => this.log.info(msg),
                warn: (msg) => this.log.warn(msg),
            },
            metrics: sample => this.diagnostics.apiRequest(sample.durationMs, sample.ok, sample.networked),
            onCircuitOpen: () => this.diagnostics.breakerTrip(),
        });
        // Setup device persistence
        const storagePath = api?.user?.storagePath?.()
            ? path.join(api.user.storagePath(), '.homebridge-myleviton-state.json')
            : undefined;
        this.devicePersistence = new persistence_1.DevicePersistence(storagePath, {
            onWarn: (msg) => this.log.warn(msg),
        });
        // Validate configuration
        if (!this.validateConfig()) {
            return;
        }
        // Initialize on Homebridge launch
        api.on('didFinishLaunching', async () => {
            await this.initialize();
            if (this.discoveryComplete) {
                this.startDiagnostics();
            }
        });
        // Cleanup on shutdown
        api.on('shutdown', () => {
            this.isShuttingDown = true;
            this.saveDeviceStates();
            this.cleanup();
        });
    }
    /**
     * Validates plugin configuration using comprehensive schema validation
     */
    validateConfig() {
        if (!this.config) {
            this.log.error(`No config for ${PLUGIN_NAME} defined.`);
            return false;
        }
        try {
            (0, validators_1.validateConfig)(this.config);
            return true;
        }
        catch (err) {
            if (err instanceof errors_1.ConfigurationError) {
                this.log.error(`Configuration error: ${err.message}`);
                if (err.details && err.details.length > 0) {
                    err.details.forEach((detail) => this.log.error(`  - ${detail}`));
                }
            }
            else {
                this.log.error(`Invalid configuration: ${(0, sanitizers_1.sanitizeError)(err)}`);
            }
            return false;
        }
    }
    /**
     * Initializes the platform, retrying on transient failures so a temporary
     * outage at startup doesn't leave the plugin permanently inert.
     */
    async initialize() {
        try {
            await this.discoverAndSetup();
            this.initAttempt = 0;
        }
        catch (error) {
            // Permanent misconfiguration (bad credentials, invalid config) won't fix
            // itself — don't hammer the API. Everything else is treated as transient.
            if (error instanceof errors_1.AuthenticationError || error instanceof errors_1.ConfigurationError) {
                this.log.error(`Initialization failed and will not be retried automatically: ${(0, sanitizers_1.sanitizeError)(error)}`);
                return;
            }
            this.initAttempt++;
            if (this.initAttempt >= MAX_INIT_ATTEMPTS) {
                this.log.error(`Initialization failed after ${MAX_INIT_ATTEMPTS} attempts; giving up until Homebridge restart: ${(0, sanitizers_1.sanitizeError)(error)}`);
                return;
            }
            const delay = Math.min(INITIAL_INIT_RETRY_MS * Math.pow(2, this.initAttempt - 1), MAX_INIT_RETRY_MS);
            this.log.warn(`Initialization failed (attempt ${this.initAttempt}), retrying in ${Math.round(delay / 1000)}s: ${(0, sanitizers_1.sanitizeError)(error)}`);
            this.scheduleInitializeRetry(delay);
        }
    }
    /**
     * Schedules a delayed re-initialization attempt unless the platform is
     * shutting down. Only one retry is ever queued at a time.
     */
    scheduleInitializeRetry(delayMs) {
        if (this.isShuttingDown || this.initRetryTimer) {
            return;
        }
        this.initRetryTimer = setTimeout(() => {
            this.initRetryTimer = null;
            void this.initialize();
        }, delayMs);
    }
    /**
     * Performs device discovery and accessory setup. Throws on failure so the
     * caller can decide whether to retry.
     */
    async discoverAndSetup() {
        this.log.info('Starting My Leviton Decora Smart platform...');
        {
            // Clean up any duplicate cache entries before processing
            // This is defensive - duplicates can occur due to race conditions in older versions
            this.deduplicateAccessories();
            const { devices, loginResponse, residenceId } = await this.discoverDevices();
            this.setLoginResponse(loginResponse);
            this.residenceId = residenceId;
            // Discovery succeeded — we just reached the cloud. Set up the optional
            // connectivity sensor and mark it online before processing devices.
            this.setupConnectivitySensor();
            this.lastRestReachabilityAt = Date.now();
            this.recomputeCloudConnectivity(true);
            if (devices.length === 0) {
                this.log.error('No devices found in your My Leviton account');
                this.discoveryComplete = true;
                this.startDiagnostics();
                this.startPolling();
                return;
            }
            // Get exclusion lists
            const excludedModels = (this.config.excludedModels || []).map(m => m.toUpperCase());
            const excludedSerials = (this.config.excludedSerials || []).map(s => s.toUpperCase());
            let newDevices = 0;
            let excludedCount = 0;
            let statelessCount = 0;
            let cachedCount = 0;
            for (const device of devices) {
                if (this.isDeviceExcluded(device, excludedModels, excludedSerials)) {
                    const existingAccessory = this.findAccessoryByDevice(device);
                    if (existingAccessory) {
                        this.removeCachedAccessory(existingAccessory);
                    }
                    excludedCount++;
                    continue;
                }
                if ((0, device_models_1.isStatelessControllerModel)(device.model)) {
                    statelessCount++;
                }
                // Check if we have a cached accessory for this device
                const existingAccessory = this.findAccessoryByDevice(device);
                if (existingAccessory) {
                    // Update cached accessory with fresh device data
                    existingAccessory.context.device = device;
                    // Scrub any auth token persisted by older versions. The token is never
                    // read from context (requests use the in-memory login response), and
                    // persisting it leaks a live credential into the on-disk accessory cache.
                    delete existingAccessory.context.token;
                    this.syncAccessoryMetadata(existingAccessory, device);
                    // Persist the updated context to cache file
                    this.api.updatePlatformAccessories([existingAccessory]);
                    // Setup service handlers (deferred from configureAccessory)
                    await this.setupService(existingAccessory);
                    cachedCount++;
                }
                else {
                    // New device - create accessory
                    await this.addAccessory(device);
                    newDevices++;
                }
            }
            this.lastCloudDeviceCount = devices.length;
            this.lastStatelessCount = statelessCount;
            this.lastExcludedCount = excludedCount;
            const controllableCount = devices.length - excludedCount - statelessCount;
            this.log.info(`Found ${devices.length} Leviton devices: ${controllableCount} controllable (${cachedCount} cached, ${newDevices} new), ${statelessCount} stateless skipped, ${excludedCount} excluded by config`);
            // Start polling
            this.startPolling();
            this.discoveryComplete = true;
            this.lastRestReachabilityAt = Date.now();
            this.startDiagnostics();
            this.log.info('Platform ready');
        }
    }
    /**
     * Discovers devices from Leviton API
     */
    async discoverDevices() {
        const debugLog = (msg) => this.log.debug(msg);
        // Login
        this.log.info('Connecting to My Leviton...');
        const loginResponse = await this.client.login(this.config.email, this.config.password, debugLog);
        const token = loginResponse.id;
        const personId = loginResponse.userId;
        this.log.info('Authentication successful');
        // Get residential permissions — iterate all accounts/residences and merge devices.
        this.log.info('Loading residence information...');
        const permissions = await this.client.getResidentialPermissions(personId, token, debugLog);
        if (!permissions.length) {
            throw new Error('No residential permissions found');
        }
        this.log.info('Discovering devices...');
        const deviceById = new Map();
        let residenceId = '';
        for (const permission of permissions) {
            const accountId = permission.residentialAccountId;
            if (!accountId) {
                continue;
            }
            let account;
            try {
                account = await this.client.getResidentialAccount(accountId, token, debugLog);
            }
            catch (err) {
                this.log.warn(`Failed to load residential account ${accountId}: ${(0, sanitizers_1.sanitizeError)(err)}`);
                continue;
            }
            if (!account.id) {
                this.log.debug(`Skipping residential account ${accountId}: missing account id`);
                continue;
            }
            const residenceIds = new Set();
            if (account.primaryResidenceId) {
                residenceIds.add(account.primaryResidenceId);
            }
            try {
                const residences = await this.client.getResidences(account.id, token, debugLog);
                for (const residence of residences) {
                    if (residence?.id) {
                        residenceIds.add(residence.id);
                    }
                }
            }
            catch (err) {
                this.log.warn(`Could not list all residences for account ${accountId}: ${(0, sanitizers_1.sanitizeError)(err)}. Using known residence ids only.`);
            }
            if (residenceIds.size === 0) {
                this.log.warn(`No residences found for account ${accountId}; skipping account`);
                continue;
            }
            for (const rid of residenceIds) {
                try {
                    const residenceDevices = await this.client.getDevices(rid, token, debugLog);
                    for (const device of residenceDevices) {
                        if (device?.id) {
                            deviceById.set(device.id, device);
                        }
                    }
                    if (!residenceId) {
                        residenceId = rid;
                    }
                }
                catch (err) {
                    this.log.warn(`Failed to load devices for residence ${rid}: ${(0, sanitizers_1.sanitizeError)(err)}`);
                }
            }
        }
        const devices = Array.from(deviceById.values());
        if (!residenceId && deviceById.size === 0) {
            throw new Error('No valid residence found in residential permissions');
        }
        // Subscribe only to controllable, non-excluded devices (skip stateless controllers).
        const excludedModels = (this.config.excludedModels || []).map(m => m.toUpperCase());
        const excludedSerials = (this.config.excludedSerials || []).map(s => s.toUpperCase());
        const wsDevices = devices.filter(d => !this.isDeviceExcluded(d, excludedModels, excludedSerials) && !(0, device_models_1.isStatelessControllerModel)(d.model));
        // Setup WebSocket for real-time updates. Close any socket left over from a
        // previous (failed) initialization attempt before creating a new one.
        if (this.webSocket) {
            this.webSocket.close();
            this.webSocket = null;
        }
        try {
            this.webSocket = (0, websocket_1.createWebSocket)(loginResponse, wsDevices, this.handleWebSocketUpdate.bind(this), {
                debug: (msg) => this.log.debug(msg),
                info: (msg) => this.log.info(msg),
                warn: (msg) => this.log.warn(msg),
                error: (msg) => this.log.error(msg),
            }, {
                ...(this.config.connectionTimeout ? { connectionTimeout: this.config.connectionTimeout } : {}),
                // Surface real-time push connectivity on the optional status sensor and
                // feed reconnect counts into diagnostics.
                onConnectionChange: (connected) => this.handleWsConnectionChange(connected),
            });
        }
        catch (err) {
            this.log.warn(`WebSocket unavailable: ${(0, sanitizers_1.sanitizeError)(err)}`);
        }
        return { devices, loginResponse, residenceId };
    }
    /**
     * Handles WebSocket update messages
     */
    handleWebSocketUpdate(payload) {
        if (!payload?.id) {
            this.log.warn('Received invalid WebSocket payload');
            return;
        }
        const accessory = this.accessories.find(acc => String(acc.context?.device?.id) === String(payload.id));
        if (!accessory) {
            this.log.debug(`No accessory found for device ID: ${payload.id}`);
            return;
        }
        const { id, power, brightness, occupancy, motion } = payload;
        const device = accessory.context?.device;
        this.log.debug(`WebSocket: ${accessory.displayName} (${id}): ${power} ${brightness ? `${brightness}%` : ''}`);
        // Get service
        const fanService = accessory.getService(hap.Service.Fan);
        const lightService = accessory.getService(hap.Service.Lightbulb);
        const switchService = accessory.getService(hap.Service.Switch);
        const outletService = accessory.getService(hap.Service.Outlet);
        const primaryService = fanService || lightService || switchService || outletService;
        if (!primaryService) {
            this.log.warn(`No service found for accessory: ${accessory.displayName}`);
            return;
        }
        // Get current state before updating
        const currentPower = primaryService.getCharacteristic(hap.Characteristic.On).value;
        const currentPowerState = currentPower ? POWER_ON : POWER_OFF;
        // Update brightness/rotation speed
        if (brightness !== undefined) {
            // Get current brightness for change detection
            let currentBrightness;
            let newBrightness;
            if (fanService) {
                // Fans allow 0 rotation speed
                newBrightness = Math.max(0, brightness);
                currentBrightness = fanService.getCharacteristic(hap.Characteristic.RotationSpeed).value;
                fanService.getCharacteristic(hap.Characteristic.RotationSpeed).updateValue(newBrightness);
            }
            else if (lightService) {
                // Dimmers have minimum brightness of 1
                newBrightness = Math.max(1, brightness);
                currentBrightness = lightService.getCharacteristic(hap.Characteristic.Brightness).value;
                lightService.getCharacteristic(hap.Characteristic.Brightness).updateValue(newBrightness);
            }
            // No else — switches/outlets don't have brightness, just skip to power update
            // Log brightness change if different and not from recent HomeKit command
            if (newBrightness !== undefined && currentBrightness !== undefined && currentBrightness !== newBrightness) {
                const lastCommandTime = device?.id ? this.recentHomeKitCommands.get(device.id) : undefined;
                const isRecentCommand = lastCommandTime && (Date.now() - lastCommandTime) < 5000; // 5 second window
                if (!isRecentCommand) {
                    this.diagnostics.externalChange();
                    this.log.info(`${accessory.displayName}: ${newBrightness}% (external)`, {
                        deviceId: device?.id,
                        operation: 'externalBrightnessUpdate',
                        brightness: newBrightness,
                    });
                }
            }
        }
        // Update power state
        if (power !== undefined) {
            const newPowerBool = power === POWER_ON;
            primaryService.getCharacteristic(hap.Characteristic.On).updateValue(newPowerBool);
            // Log power change if different and not from recent HomeKit command
            if (currentPowerState !== power) {
                const lastCommandTime = device?.id ? this.recentHomeKitCommands.get(device.id) : undefined;
                const isRecentCommand = lastCommandTime && (Date.now() - lastCommandTime) < 5000; // 5 second window
                if (!isRecentCommand) {
                    this.diagnostics.externalChange();
                    this.log.info(`${accessory.displayName}: ${power} (external)`, {
                        deviceId: device?.id,
                        operation: 'externalPowerUpdate',
                        power,
                    });
                }
            }
        }
        // Update motion sensor
        const motionService = accessory.getService(hap.Service.MotionSensor);
        if (motionService && (occupancy !== undefined || motion !== undefined)) {
            const motionDetected = occupancy === true || motion === true;
            motionService.getCharacteristic(hap.Characteristic.MotionDetected).updateValue(motionDetected);
        }
        // Invalidate API cache for this device so next getStatus() fetches fresh data
        // This ensures cached API responses don't become stale after real-time updates
        this.client.invalidateDeviceCache(String(payload.id));
    }
    /**
     * Checks if device should be excluded
     */
    isDeviceExcluded(device, excludedModels, excludedSerials) {
        if (!device?.model || !device?.serial) {
            return false;
        }
        return excludedModels.includes(device.model.toUpperCase()) ||
            excludedSerials.includes(device.serial.toUpperCase());
    }
    /**
     * Adds a new accessory
     */
    async addAccessory(device) {
        if (!device?.serial || !device?.name) {
            this.log.error('Invalid device object provided to addAccessory');
            return;
        }
        this.log.info(`Adding device: ${device.name} (${device.model})`);
        const uuid = hap.uuid.generate(UUID_PREFIX + device.serial);
        const accessory = new this.api.platformAccessory(this.getHapDeviceName(device), uuid);
        // Note: the auth token is intentionally NOT stored in context. It's never
        // read back (requests use the in-memory login response) and persisting it
        // would write a live credential to the on-disk accessory cache.
        accessory.context = { device };
        this.syncAccessoryMetadata(accessory, device);
        // Setup service
        await this.setupService(accessory);
        // Register with Homebridge
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
    }
    /**
     * Creates (or removes) the optional cloud-connectivity status sensor.
     *
     * Exposed as a HomeKit ContactSensor: "contact detected" means the plugin can
     * reach the Leviton cloud, "contact not detected" means it cannot — so users
     * can build automations or notifications on loss of connectivity. The state is
     * driven by the WebSocket connection callback and the polling heartbeat.
     */
    setupConnectivitySensor() {
        const uuid = hap.uuid.generate(CONNECTIVITY_UUID_SEED);
        const existing = this.accessories.find(acc => acc.UUID === uuid);
        // Disabled: remove any previously-created sensor so toggling off takes effect.
        if (!this.config.connectivitySensor) {
            if (existing) {
                this.log.info('Removing connectivity sensor (disabled in config)');
                this.removeCachedAccessory(existing);
            }
            this.connectivityService = null;
            return;
        }
        const name = (0, sanitizers_1.sanitizeHapName)(this.config.connectivitySensorName || DEFAULT_CONNECTIVITY_NAME, DEFAULT_CONNECTIVITY_NAME);
        let accessory = existing;
        if (!accessory) {
            accessory = new this.api.platformAccessory(name, uuid);
            accessory.context = { connectivity: true };
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
            this.log.info(`Added connectivity sensor: ${name}`);
        }
        else {
            accessory.context = { connectivity: true };
            this.updateAccessoryDisplayName(accessory, name);
        }
        const service = accessory.getService(hap.Service.ContactSensor) ||
            accessory.addService(hap.Service.ContactSensor, name);
        service.setCharacteristic(hap.Characteristic.Name, name);
        service.getCharacteristic(hap.Characteristic.StatusActive).updateValue(true);
        const infoService = accessory.getService(hap.Service.AccessoryInformation);
        if (infoService) {
            infoService
                .setCharacteristic(hap.Characteristic.Name, name)
                .setCharacteristic(hap.Characteristic.Manufacturer, 'homebridge-myleviton')
                .setCharacteristic(hap.Characteristic.Model, 'Cloud Connectivity')
                .setCharacteristic(hap.Characteristic.SerialNumber, CONNECTIVITY_UUID_SEED);
        }
        this.connectivityService = service;
        this.api.updatePlatformAccessories([accessory]);
    }
    /**
     * Reflects the latest cloud-connectivity state on the status sensor.
     * No-op when the sensor is disabled.
     */
    updateConnectivity(online) {
        if (!this.connectivityService) {
            return;
        }
        const changed = online !== this.isCloudOnline;
        this.isCloudOnline = online;
        this.connectivityService
            .getCharacteristic(hap.Characteristic.ContactSensorState)
            .updateValue(online
            ? hap.Characteristic.ContactSensorState.CONTACT_DETECTED
            : hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
        this.connectivityService
            .getCharacteristic(hap.Characteristic.StatusFault)
            .updateValue(online
            ? hap.Characteristic.StatusFault.NO_FAULT
            : hap.Characteristic.StatusFault.GENERAL_FAULT);
        if (changed) {
            if (online) {
                this.log.info('Leviton cloud connectivity restored');
            }
            else {
                this.log.warn('Leviton cloud connectivity lost');
            }
        }
    }
    /**
     * Gets a HAP-valid name while keeping the Leviton device name as the source.
     */
    getHapDeviceName(device) {
        return (0, sanitizers_1.sanitizeHapName)(device.name || 'Unknown Device', 'Unknown Device');
    }
    /**
     * Updates an accessory's display name on both the PlatformAccessory wrapper
     * and the underlying HAP Accessory. Homebridge serializes the wrapper field
     * but the HAP Accessory.displayName is what HAP-NodeJS validates at construction
     * during cache deserialization, so both must stay in sync.
     */
    updateAccessoryDisplayName(accessory, name) {
        if (typeof accessory.updateDisplayName === 'function') {
            accessory.updateDisplayName(name);
            return;
        }
        accessory.displayName = name;
        if (accessory._associatedHAPAccessory) {
            accessory._associatedHAPAccessory.displayName = name;
        }
    }
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
    normalizeServiceDisplayNames(accessory) {
        const services = accessory.services;
        if (!Array.isArray(services) || services.length === 0) {
            return false;
        }
        let mutated = false;
        const accessoryFallback = (typeof accessory.displayName === 'string' && accessory.displayName) ||
            'Leviton Device';
        for (const service of services) {
            const original = typeof service?.displayName === 'string' ? service.displayName : '';
            if (!original || (0, sanitizers_1.isValidHapName)(original)) {
                continue;
            }
            const sanitized = (0, sanitizers_1.sanitizeHapName)(original, accessoryFallback);
            if (sanitized === original) {
                continue;
            }
            service.displayName = sanitized;
            mutated = true;
            if (typeof service.testCharacteristic === 'function' &&
                service.testCharacteristic(hap.Characteristic.Name)) {
                try {
                    service.setCharacteristic(hap.Characteristic.Name, sanitized);
                }
                catch {
                    // Some services reject Name updates (e.g. read-only on certain HAP versions);
                    // mutating displayName above is what actually affects the cache file.
                }
            }
        }
        return mutated;
    }
    /**
     * Keeps cached Homebridge metadata aligned with the latest Leviton device record.
     * Also normalizes every service's `displayName` field, since that value is what
     * HAP-NodeJS validates during cache deserialization on subsequent restarts.
     */
    syncAccessoryMetadata(accessory, device) {
        const deviceName = this.getHapDeviceName(device);
        this.updateAccessoryDisplayName(accessory, deviceName);
        const infoService = accessory.getService(hap.Service.AccessoryInformation);
        if (infoService) {
            infoService
                .setCharacteristic(hap.Characteristic.Name, deviceName)
                .setCharacteristic(hap.Characteristic.SerialNumber, device.serial || 'Unknown')
                .setCharacteristic(hap.Characteristic.Manufacturer, device.manufacturer || 'Leviton')
                .setCharacteristic(hap.Characteristic.Model, device.model || 'Unknown')
                .setCharacteristic(hap.Characteristic.FirmwareRevision, device.version || 'Unknown');
        }
        this.syncExistingServiceNames(accessory, device);
        this.normalizeServiceDisplayNames(accessory);
    }
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
    configureAccessory(accessory) {
        this.normalizeCachedAccessoryNames(accessory);
        this.log.debug(`Configuring cached accessory: ${accessory.displayName}`);
        this.accessories.push(accessory);
    }
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
    normalizeCachedAccessoryNames(accessory) {
        const cachedDevice = accessory.context?.device;
        const sourceName = (typeof accessory.displayName === 'string' && accessory.displayName) ||
            cachedDevice?.name ||
            '';
        if (!sourceName) {
            return;
        }
        const sanitizedName = (0, sanitizers_1.sanitizeHapName)(sourceName, 'Leviton Device');
        const accessoryNeedsRewrite = !cachedDevice
            ? accessory.displayName !== sanitizedName
            : (cachedDevice.name !== sanitizedName ||
                accessory.displayName !== sanitizedName);
        // Detect service rewrites BEFORE syncAccessoryMetadata, since that path also
        // normalizes services (idempotently) and would mask the bool we need to
        // decide whether the on-disk cache requires a flush.
        const servicesMutated = this.normalizeServiceDisplayNames(accessory);
        if (cachedDevice) {
            cachedDevice.name = sanitizedName;
            this.syncAccessoryMetadata(accessory, cachedDevice);
        }
        else {
            this.updateAccessoryDisplayName(accessory, sanitizedName);
            const infoService = accessory.getService(hap.Service.AccessoryInformation);
            if (infoService) {
                infoService.setCharacteristic(hap.Characteristic.Name, sanitizedName);
            }
        }
        if (!accessoryNeedsRewrite && !servicesMutated) {
            return;
        }
        try {
            this.api.updatePlatformAccessories([accessory]);
        }
        catch (err) {
            this.log.warn(`Failed to persist sanitized cache for ${sanitizedName}: ${(0, sanitizers_1.sanitizeError)(err)}`);
        }
    }
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
    deduplicateAccessories() {
        const seen = new Set();
        const duplicates = [];
        const unique = [];
        for (const accessory of this.accessories) {
            // Skip accessories without a valid UUID (shouldn't happen, but defensive)
            if (!accessory.UUID) {
                this.log.warn(`Skipping accessory without UUID: ${accessory.displayName}`);
                continue;
            }
            if (seen.has(accessory.UUID)) {
                duplicates.push(accessory);
                this.log.debug(`Duplicate cache entry: "${accessory.displayName}" (UUID: ${accessory.UUID})`);
            }
            else {
                seen.add(accessory.UUID);
                unique.push(accessory);
            }
        }
        if (duplicates.length > 0) {
            // Unregister duplicates from Homebridge (removes from cache file)
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, duplicates);
            // Update our array to only contain unique accessories
            this.accessories.length = 0;
            this.accessories.push(...unique);
            this.log.info(`Removed ${duplicates.length} duplicate cache entries (${unique.length} unique accessories)`);
        }
        return duplicates.length;
    }
    /**
     * Finds a cached accessory matching the given device by serial number
     * Uses case-insensitive comparison for robustness
     */
    findAccessoryByDevice(device) {
        const deviceSerial = String(device.serial || '').trim().toUpperCase();
        if (!deviceSerial) {
            return undefined;
        }
        return this.accessories.find(acc => {
            const cachedSerial = String(acc.context?.device?.serial || '').trim().toUpperCase();
            return cachedSerial === deviceSerial;
        });
    }
    /**
     * Removes an accessory from Homebridge cache and local tracking
     */
    removeCachedAccessory(accessory) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        const index = this.accessories.indexOf(accessory);
        if (index !== -1) {
            this.accessories.splice(index, 1);
        }
    }
    /**
     * Sets up the appropriate service for a device
     */
    async setupService(accessory) {
        const device = accessory.context?.device;
        if (!device) {
            this.log.error(`Missing device in accessory context: ${accessory.displayName}`);
            return;
        }
        const model = device.model || '';
        // Button controllers don't have controllable state - skip them
        if ((0, device_models_1.isStatelessControllerModel)(model)) {
            this.log.debug(`Skipping controller device: ${device.name} (${model})`);
            return;
        }
        if (device_models_1.FAN_MODELS.includes(model)) {
            await this.setupFanService(accessory, device);
        }
        else if (device_models_1.MOTION_DIMMER_MODELS.includes(model)) {
            await this.setupMotionDimmerService(accessory, device);
        }
        else if (device_models_1.DIMMER_MODELS.includes(model)) {
            await this.setupLightbulbService(accessory, device);
        }
        else if (device_models_1.OUTLET_MODELS.includes(model)) {
            await this.setupBasicService(accessory, device, hap.Service.Outlet);
        }
        else if (device_models_1.SWITCH_MODELS.includes(model)) {
            await this.setupBasicService(accessory, device, hap.Service.Switch);
        }
        else {
            // Unknown model - treat as switch
            this.log.info(`Unknown device model '${model}' for ${device.name}, treating as switch`);
            await this.setupBasicService(accessory, device, hap.Service.Switch);
        }
    }
    /**
     * Gets device status with error handling
     */
    async getStatus(device, fallbackStatus) {
        try {
            const status = await this.withTokenRetry(async () => {
                const token = await this.ensureValidToken();
                return this.client.getDeviceStatus(device.id, token);
            });
            this.devicePersistence.updateFromStatus(device.id, status);
            return status;
        }
        catch (err) {
            this.log.error(`Failed to get status for ${device.name}: ${(0, sanitizers_1.sanitizeError)(err)}`);
            if (fallbackStatus) {
                return fallbackStatus;
            }
            const cachedStatus = this.devicePersistence.getCachedStatus(device.id);
            if (cachedStatus) {
                return {
                    minLevel: 1,
                    maxLevel: 100,
                    ...cachedStatus,
                };
            }
            return { power: POWER_OFF, brightness: 0, minLevel: 1, maxLevel: 100 };
        }
    }
    /**
     * Captures the current HomeKit state before reconfiguring a cached accessory.
     */
    getCurrentServiceStatus(service, levelCharacteristic) {
        const onValue = service.getCharacteristic(hap.Characteristic.On).value;
        if (typeof onValue !== 'boolean') {
            return undefined;
        }
        const status = {
            power: onValue ? POWER_ON : POWER_OFF,
            minLevel: 1,
            maxLevel: 100,
        };
        if (levelCharacteristic) {
            const levelValue = this.readCharacteristicValue(service, levelCharacteristic);
            if (levelValue !== undefined) {
                status.brightness = levelValue;
            }
        }
        return status;
    }
    serviceHasCharacteristic(service, characteristic) {
        return typeof service.testCharacteristic === 'function'
            && service.testCharacteristic(characteristic);
    }
    /**
     * Reads a level characteristic only when it already exists on the service.
     * Never auto-adds characteristics (Homebridge warns when Brightness is added
     * to Outlet/Fan/Switch services).
     */
    readCharacteristicValue(service, characteristic) {
        if (!this.serviceHasCharacteristic(service, characteristic)) {
            return undefined;
        }
        const value = service.getCharacteristic(characteristic).value;
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }
    /**
     * Reads dimmer brightness or fan rotation speed for persistence snapshots.
     */
    readAccessoryLevelForPersistence(accessory) {
        const lightService = accessory.getService(hap.Service.Lightbulb);
        if (lightService) {
            const brightness = this.readCharacteristicValue(lightService, hap.Characteristic.Brightness);
            if (brightness !== undefined) {
                return brightness;
            }
        }
        const fanService = accessory.getService(hap.Service.Fan);
        if (fanService) {
            return this.readCharacteristicValue(fanService, hap.Characteristic.RotationSpeed);
        }
        return undefined;
    }
    /**
     * Sets up a lightbulb service
     * @returns The device status used for initialization (allows callers to reuse it)
     */
    async setupLightbulbService(accessory, device) {
        const serviceName = this.getHapDeviceName(device);
        const existingService = this.getServiceByNameOrType(accessory, hap.Service.Lightbulb, serviceName);
        const fallbackStatus = existingService
            ? this.getCurrentServiceStatus(existingService, hap.Characteristic.Brightness)
            : undefined;
        const status = await this.getStatus(device, fallbackStatus);
        const service = existingService || accessory.addService(hap.Service.Lightbulb, serviceName);
        this.syncServiceName(service, serviceName);
        // Calculate valid brightness range
        const minBrightness = status.minLevel || 1;
        const maxBrightness = status.maxLevel || 100;
        // Ensure brightness is within valid range (0 is invalid for HomeKit Brightness which has minValue=1)
        const rawBrightness = typeof status.brightness === 'number' ? status.brightness : 0;
        const safeBrightness = rawBrightness < minBrightness ? minBrightness : rawBrightness;
        // Setup On characteristic
        // No 'get' handler — Homebridge returns the cached value set by updateValue(),
        // which is kept current by WebSocket push updates and polling fallback.
        const onChar = service.getCharacteristic(hap.Characteristic.On);
        onChar.removeAllListeners('get');
        onChar.removeAllListeners('set');
        onChar.on('set', this.createPowerSetter(device));
        onChar.updateValue(status.power === POWER_ON);
        // Setup Brightness characteristic
        // Use getCharacteristic which always returns a valid Characteristic object
        // No 'get' handler — value kept current by WebSocket + polling via updateValue()
        const brightnessChar = service.getCharacteristic(hap.Characteristic.Brightness);
        // For cached accessories, update value to safe minimum BEFORE setting restrictive props
        // This prevents HAP validation error when cached value (e.g., 0) violates new minValue
        brightnessChar.updateValue(safeBrightness);
        brightnessChar.setProps({ minValue: minBrightness, maxValue: maxBrightness, minStep: 1 });
        brightnessChar.removeAllListeners('get');
        brightnessChar.removeAllListeners('set');
        brightnessChar.on('set', this.createBrightnessSetter(device));
        return status;
    }
    /**
     * Sets up a motion dimmer service
     */
    async setupMotionDimmerService(accessory, device) {
        // Reuse the status returned by setupLightbulbService to avoid a second API call
        const status = await this.setupLightbulbService(accessory, device);
        const motionName = (0, sanitizers_1.sanitizeHapName)(`${device.name} Motion`, 'Motion Sensor');
        const motionService = accessory.getService(hap.Service.MotionSensor) ||
            accessory.addService(hap.Service.MotionSensor, motionName);
        this.syncServiceName(motionService, motionName);
        motionService
            .getCharacteristic(hap.Characteristic.MotionDetected)
            .updateValue(status.occupancy === true || status.motion === true);
    }
    /**
     * Sets up a fan service
     */
    async setupFanService(accessory, device) {
        const serviceName = this.getHapDeviceName(device);
        const existingService = this.getServiceByNameOrType(accessory, hap.Service.Fan, serviceName);
        const fallbackStatus = existingService
            ? this.getCurrentServiceStatus(existingService, hap.Characteristic.RotationSpeed)
            : undefined;
        const status = await this.getStatus(device, fallbackStatus);
        const service = existingService || accessory.addService(hap.Service.Fan, serviceName);
        this.syncServiceName(service, serviceName);
        // Setup On characteristic — no 'get' handler, value kept current by WebSocket + polling
        const onChar = service.getCharacteristic(hap.Characteristic.On);
        onChar.removeAllListeners('get');
        onChar.removeAllListeners('set');
        onChar.on('set', this.createPowerSetter(device));
        onChar.updateValue(status.power === POWER_ON);
        // Setup RotationSpeed characteristic - set props before value
        // No 'get' handler — value kept current by WebSocket + polling via updateValue()
        const speedChar = service.getCharacteristic(hap.Characteristic.RotationSpeed);
        speedChar.setProps({ minValue: 0, maxValue: status.maxLevel || 100, minStep: status.minLevel || 1 });
        speedChar.removeAllListeners('get');
        speedChar.removeAllListeners('set');
        speedChar.on('set', this.createBrightnessSetter(device));
        speedChar.updateValue(status.brightness || 0);
    }
    /**
     * Sets up a basic switch/outlet service
     */
    async setupBasicService(accessory, device, ServiceType) {
        const serviceName = this.getHapDeviceName(device);
        const existingService = this.getServiceByNameOrType(accessory, ServiceType, serviceName);
        const fallbackStatus = existingService
            ? this.getCurrentServiceStatus(existingService)
            : undefined;
        const status = await this.getStatus(device, fallbackStatus);
        const service = existingService || accessory.addService(ServiceType, serviceName);
        this.syncServiceName(service, serviceName);
        // Remove existing listeners to prevent stacking on cached accessories
        // No 'get' handler — value kept current by WebSocket + polling via updateValue()
        const onChar = service.getCharacteristic(hap.Characteristic.On);
        onChar.removeAllListeners('get');
        onChar.removeAllListeners('set');
        onChar.on('set', this.createPowerSetter(device));
        onChar.updateValue(status.power === POWER_ON);
    }
    getServiceByNameOrType(accessory, ServiceType, serviceName) {
        return accessory.getService(ServiceType, serviceName) || accessory.getService(ServiceType);
    }
    syncServiceName(service, serviceName) {
        service.setCharacteristic(hap.Characteristic.Name, serviceName);
    }
    syncExistingServiceNames(accessory, device) {
        const serviceName = this.getHapDeviceName(device);
        const serviceTypes = [
            hap.Service.Lightbulb,
            hap.Service.Fan,
            hap.Service.Switch,
            hap.Service.Outlet,
        ];
        for (const serviceType of serviceTypes) {
            const service = accessory.getService(serviceType);
            if (service) {
                this.syncServiceName(service, serviceName);
            }
        }
        const motionService = accessory.getService(hap.Service.MotionSensor);
        if (motionService) {
            this.syncServiceName(motionService, (0, sanitizers_1.sanitizeHapName)(`${device.name} Motion`, 'Motion Sensor'));
        }
    }
    /**
     * Creates a power setter handler
     */
    // HAP-NodeJS set handlers are loosely typed; narrow at the implementation boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createPowerSetter(device) {
        return async (value, callback) => {
            const startTime = Date.now();
            // Track this HomeKit command to avoid logging it as "external" later
            this.recentHomeKitCommands.set(device.id, Date.now());
            this.pruneRecentHomeKitCommands();
            this.diagnostics.command();
            try {
                await this.withTokenRetry(async () => {
                    const token = await this.ensureValidToken();
                    await this.client.setPower(device.id, token, value);
                });
                const latency = Date.now() - startTime;
                this.log.info(`${device.name}: ${value ? 'ON' : 'OFF'} (Latency: ${latency}ms)`, {
                    deviceId: device.id,
                    operation: 'setPower',
                    duration: latency,
                });
                callback();
            }
            catch (err) {
                this.recordThrottleIfRateLimited(err);
                callback(new Error((0, sanitizers_1.sanitizeError)(err)));
            }
        };
    }
    /**
     * Creates a brightness setter handler
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createBrightnessSetter(device) {
        return async (value, callback) => {
            const startTime = Date.now();
            // Track this HomeKit command to avoid logging it as "external" later
            this.recentHomeKitCommands.set(device.id, Date.now());
            this.pruneRecentHomeKitCommands();
            this.diagnostics.command();
            try {
                await this.withTokenRetry(async () => {
                    const token = await this.ensureValidToken();
                    await this.client.setBrightness(device.id, token, value);
                });
                const latency = Date.now() - startTime;
                this.log.info(`${device.name}: ${value}% (Latency: ${latency}ms)`, {
                    deviceId: device.id,
                    operation: 'setBrightness',
                    duration: latency,
                });
                callback();
            }
            catch (err) {
                this.recordThrottleIfRateLimited(err);
                callback(new Error((0, sanitizers_1.sanitizeError)(err)));
            }
        };
    }
    /**
     * Store login response and compute token expiry
     */
    setLoginResponse(loginResponse) {
        this.currentLoginResponse = loginResponse;
        if (typeof loginResponse.ttl === 'number' && Number.isFinite(loginResponse.ttl)) {
            this.tokenExpiresAt = Date.now() + loginResponse.ttl * 1000;
        }
        else {
            this.tokenExpiresAt = Date.now() + DEFAULT_TOKEN_TTL_SEC * 1000;
            this.log.debug(`Login response missing ttl; assuming ${DEFAULT_TOKEN_TTL_SEC}s token lifetime`);
        }
    }
    /**
     * Check if the token is close to expiring
     */
    isTokenExpiringSoon() {
        if (!this.tokenExpiresAt) {
            return false;
        }
        return Date.now() >= this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS;
    }
    /**
     * Retry once on authentication errors
     */
    async withTokenRetry(operation) {
        try {
            return await operation();
        }
        catch (err) {
            if (err instanceof errors_1.AuthenticationError) {
                this.log.warn('Authentication failed, refreshing token and retrying...');
                await this.refreshToken();
                this.diagnostics.retry();
                return await operation();
            }
            throw err;
        }
    }
    /**
     * Ensures a valid token is available
     */
    async ensureValidToken() {
        if (this.currentLoginResponse && !this.isTokenExpiringSoon()) {
            return this.currentLoginResponse.id;
        }
        const loginResponse = await this.refreshToken();
        return loginResponse.id;
    }
    /**
     * Refreshes the authentication token
     */
    async refreshToken() {
        if (this.tokenRefreshPromise) {
            return this.tokenRefreshPromise;
        }
        if (this.lastRefreshFailureAt !== null &&
            Date.now() - this.lastRefreshFailureAt < TOKEN_REFRESH_FAILURE_COOLDOWN_MS) {
            const remainingMs = TOKEN_REFRESH_FAILURE_COOLDOWN_MS - (Date.now() - this.lastRefreshFailureAt);
            this.log.debug(`Token refresh throttled after recent failure (${Math.ceil(remainingMs / 1000)}s remaining)`);
            throw new errors_1.AuthenticationError('Token refresh temporarily throttled after recent failure');
        }
        this.tokenRefreshPromise = (async () => {
            const loginResponse = await this.client.login(this.config.email, this.config.password);
            this.setLoginResponse(loginResponse);
            // Update WebSocket with new login response and force reconnect so stale auth is not reused.
            if (this.webSocket) {
                this.webSocket.updateLoginResponse(loginResponse);
                this.webSocket.forceReconnect();
            }
            this.lastRefreshFailureAt = null;
            this.lastTokenRefreshAt = Date.now();
            this.diagnostics.tokenRefresh();
            this.log.info('Token refreshed successfully');
            return loginResponse;
        })();
        try {
            return await this.tokenRefreshPromise;
        }
        catch (err) {
            this.lastRefreshFailureAt = Date.now();
            throw err;
        }
        finally {
            this.tokenRefreshPromise = null;
        }
    }
    /**
     * Starts polling for device updates
     */
    startPolling() {
        if (this.pollingInterval) {
            return;
        }
        if (this.config.pollInterval === undefined && this.config.pollingInterval !== undefined) {
            this.log.warn("Config option 'pollingInterval' is deprecated; use 'pollInterval' instead.");
        }
        const intervalSeconds = this.config.pollInterval ?? this.config.pollingInterval ?? 30;
        const interval = Math.max(intervalSeconds * 1000, 10000);
        this.pollingInterval = setInterval(async () => {
            if (this.isPolling) {
                this.log.debug('Skipping poll tick because previous poll cycle is still running');
                return;
            }
            this.isPolling = true;
            try {
                await this.pollDevices();
            }
            catch (err) {
                this.log.debug(`Polling cycle failed: ${(0, sanitizers_1.sanitizeError)(err)}`);
            }
            finally {
                this.isPolling = false;
            }
        }, interval);
    }
    /**
     * Polls all devices for updates
     *
     * This is a fallback mechanism when WebSocket updates are unavailable.
     * Fetches actual device status from the API for each accessory.
     *
     * IMPORTANT: On API failure, we preserve current HomeKit state rather than
     * updating with fallback values. This prevents incorrect state during outages.
     */
    async pollDevices() {
        if (!this.residenceId) {
            return;
        }
        const pollTargets = this.accessories
            .map(accessory => accessory.context?.device)
            .filter((device) => Boolean(device?.id));
        // Track whether any device fetch succeeded this cycle so the polling loop
        // can double as a cloud-reachability heartbeat for the connectivity sensor.
        let anyPollSucceeded = false;
        let pollOk = 0;
        let pollFailed = 0;
        const cycleStart = Date.now();
        const pollSingleDevice = async (device) => {
            try {
                // Fetch actual device status from API (bypass getStatus to avoid fallback values)
                const status = await this.withTokenRetry(async () => {
                    const token = await this.ensureValidToken();
                    return this.client.getDeviceStatus(device.id, token);
                });
                anyPollSucceeded = true;
                pollOk++;
                // Only update HomeKit if we got real data from API. Include motion/
                // occupancy so motion sensors stay current via polling when the
                // WebSocket push channel is unavailable.
                this.handleWebSocketUpdate({
                    id: device.id,
                    power: status.power,
                    brightness: status.brightness,
                    occupancy: status.occupancy,
                    motion: status.motion,
                });
            }
            catch (err) {
                // On API failure, preserve current HomeKit state - don't update with fallback values
                pollFailed++;
                this.log.debug(`Polling skipped for ${device.name}: ${(0, sanitizers_1.sanitizeError)(err)}`);
            }
        };
        if (pollTargets.length === 0) {
            await this.pollRestReachabilityHeartbeat();
            return;
        }
        const workerCount = Math.min(POLL_DEVICE_CONCURRENCY, pollTargets.length);
        let nextIndex = 0;
        const workers = Array.from({ length: workerCount }, async () => {
            // Shared index keeps worker fan-out bounded while still parallelizing requests.
            while (nextIndex < pollTargets.length) {
                const currentIndex = nextIndex++;
                await pollSingleDevice(pollTargets[currentIndex]);
            }
        });
        await Promise.all(workers);
        this.diagnostics.pollCycle(pollOk, pollFailed, Date.now() - cycleStart);
        // The poll cycle reached (or failed to reach) the cloud — use that as a
        // heartbeat for the connectivity sensor, covering the case where the
        // WebSocket is down but REST still works (or vice versa).
        this.recomputeCloudConnectivity(anyPollSucceeded);
    }
    /**
     * Combines WebSocket push and REST poll signals for the connectivity sensor.
     * Online when WS is connected or a poll succeeded within two poll intervals.
     */
    recomputeCloudConnectivity(restReachable) {
        if (restReachable === true) {
            this.lastRestReachabilityAt = Date.now();
        }
        const pollWindowMs = this.pollingCadenceSeconds() * 1000 * 2;
        const restFresh = this.lastRestReachabilityAt !== null &&
            Date.now() - this.lastRestReachabilityAt <= pollWindowMs;
        this.updateConnectivity(this.wsPushConnected || restFresh);
    }
    /**
     * Proves REST reachability when there are no device poll targets (e.g. all
     * excluded, zero devices, connectivity-only). Keeps the optional connectivity
     * sensor accurate when WebSocket is down.
     */
    async pollRestReachabilityHeartbeat() {
        try {
            const token = await this.ensureValidToken();
            const personId = this.currentLoginResponse?.userId;
            if (!personId) {
                this.recomputeCloudConnectivity(false);
                return;
            }
            await this.client.getResidentialPermissions(personId, token);
            this.recomputeCloudConnectivity(true);
        }
        catch (err) {
            this.log.debug(`REST connectivity heartbeat failed: ${(0, sanitizers_1.sanitizeError)(err)}`);
            this.recomputeCloudConnectivity(false);
        }
    }
    /**
     * Prunes stale HomeKit command timestamps to prevent unbounded map growth.
     */
    pruneRecentHomeKitCommands(now = Date.now()) {
        for (const [deviceId, timestamp] of this.recentHomeKitCommands) {
            if (now - timestamp > RECENT_HOMEKIT_COMMAND_TTL_MS) {
                this.recentHomeKitCommands.delete(deviceId);
            }
        }
    }
    /**
     * Saves device states to persistence
     */
    saveDeviceStates() {
        try {
            this.accessories.forEach(accessory => {
                const device = accessory.context?.device;
                if (device) {
                    const service = accessory.getService(hap.Service.Lightbulb) ||
                        accessory.getService(hap.Service.Fan) ||
                        accessory.getService(hap.Service.Switch) ||
                        accessory.getService(hap.Service.Outlet);
                    if (service) {
                        const isOn = service.getCharacteristic(hap.Characteristic.On).value;
                        const update = {
                            id: device.id,
                            name: device.name,
                            model: device.model,
                            power: isOn ? POWER_ON : POWER_OFF,
                        };
                        const level = this.readAccessoryLevelForPersistence(accessory);
                        if (level !== undefined) {
                            update.brightness = level;
                        }
                        this.devicePersistence.updateDevice(device.id, update);
                    }
                }
            });
            this.devicePersistence.save();
        }
        catch (err) {
            this.log.error(`Failed to save device states: ${(0, sanitizers_1.sanitizeError)(err)}`);
        }
    }
    /**
     * Cleans up resources
     */
    cleanup() {
        // Emit the cumulative stop snapshot before tearing down the heartbeat timer.
        if (this.diagnosticsTimer) {
            try {
                this.emitDiagnostic('info', this.diagnostics.snapshot('diagnostics.stop', this.buildDiagnosticsReaders()));
            }
            catch (err) {
                this.log.debug(`Failed to emit diagnostics stop snapshot: ${(0, sanitizers_1.sanitizeError)(err)}`);
            }
            clearInterval(this.diagnosticsTimer);
            this.diagnosticsTimer = null;
        }
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.initRetryTimer) {
            clearTimeout(this.initRetryTimer);
            this.initRetryTimer = null;
        }
        if (this.webSocket) {
            this.webSocket.close();
            this.webSocket = null;
        }
    }
    /**
     * Records a rate-limit rejection on the diagnostics collector when a write
     * was throttled client-side (HTTP 429 from the rate limiter).
     */
    recordThrottleIfRateLimited(err) {
        if (err instanceof errors_1.ApiResponseError && err.httpStatus === 429) {
            this.diagnostics.throttle();
        }
    }
    /**
     * Handles WebSocket connection-state changes: drives the connectivity sensor
     * and counts reconnections (a recovery after a prior disconnect) for diagnostics.
     */
    handleWsConnectionChange(connected) {
        if (connected && this.wsHasDisconnected) {
            this.diagnostics.wsReconnect();
            this.wsHasDisconnected = false;
        }
        else if (!connected) {
            this.wsHasDisconnected = true;
        }
        this.wsPushConnected = connected;
        this.recomputeCloudConnectivity();
    }
    /**
     * Diagnostics heartbeat interval in milliseconds (0 when disabled).
     */
    diagnosticsIntervalMs() {
        const seconds = this.config?.diagnosticsInterval;
        if (typeof seconds !== 'number' || seconds <= 0) {
            return 0;
        }
        return seconds * 1000;
    }
    /**
     * Effective polling cadence in seconds (mirrors startPolling's clamping).
     */
    pollingCadenceSeconds() {
        const intervalSeconds = this.config.pollInterval ?? this.config.pollingInterval ?? 30;
        return Math.max(intervalSeconds, 10);
    }
    /**
     * Starts the diagnostics subsystem: emits the boot snapshot and schedules the
     * heartbeat. No-op unless diagnosticsInterval > 0.
     */
    startDiagnostics() {
        const interval = this.diagnosticsIntervalMs();
        if (interval <= 0 || this.isShuttingDown || this.diagnosticsTimer) {
            return;
        }
        // Diagnostics must never be able to crash the host. A failure here only
        // means we skip the boot snapshot; the heartbeat is still scheduled.
        try {
            const startReport = this.diagnostics.snapshot('diagnostics.start', this.buildDiagnosticsReaders());
            this.lastDiagnosticsHealth = startReport.lifecycle.health;
            this.emitDiagnostic('info', startReport);
        }
        catch (err) {
            this.log.debug(`Failed to emit diagnostics start snapshot: ${(0, sanitizers_1.sanitizeError)(err)}`);
        }
        this.diagnosticsTimer = setInterval(() => this.diagnosticsHeartbeat(), interval);
    }
    /**
     * Emits a single heartbeat (per-interval deltas) and logs health transitions.
     * Wrapped so a reader failure can never escape the timer and crash Homebridge.
     */
    diagnosticsHeartbeat() {
        try {
            const report = this.diagnostics.buildHeartbeat(this.buildDiagnosticsReaders());
            this.emitDiagnostic('info', report);
            const health = report.lifecycle.health;
            if (this.lastDiagnosticsHealth !== null && health !== this.lastDiagnosticsHealth) {
                const isDegraded = health === 'degraded';
                const transition = {
                    ...report,
                    msg: isDegraded ? 'health.degraded' : 'health.recovered',
                };
                this.emitDiagnostic(isDegraded ? 'warn' : 'info', transition);
            }
            this.lastDiagnosticsHealth = health;
        }
        catch (err) {
            this.log.debug(`Diagnostics heartbeat failed: ${(0, sanitizers_1.sanitizeError)(err)}`);
        }
    }
    /**
     * Builds the synchronous, in-memory readers the collector uses. Never performs
     * network I/O.
     */
    buildDiagnosticsReaders() {
        return {
            clientStatus: () => this.client.getStatus(),
            wsStatus: () => (this.webSocket ? this.webSocket.getStatus() : null),
            devices: () => this.collectDeviceGauges(),
            tokenExpiresInSec: () => this.tokenExpiresAt === null
                ? null
                : Math.round((this.tokenExpiresAt - Date.now()) / 1000),
            tokenLastRefreshAt: () => this.lastTokenRefreshAt,
            tokenRefreshFailureActive: () => this.lastRefreshFailureAt !== null &&
                Date.now() - this.lastRefreshFailureAt < TOKEN_REFRESH_FAILURE_COOLDOWN_MS,
            pollingCadenceSec: () => this.pollingCadenceSeconds(),
        };
    }
    /**
     * Computes absolute device gauges from the current accessories (the optional
     * connectivity sensor and stateless controllers are excluded).
     */
    collectDeviceGauges() {
        const byType = {};
        let total = 0;
        let on = 0;
        for (const accessory of this.accessories) {
            if (accessory.context?.connectivity) {
                continue;
            }
            const device = accessory.context?.device;
            if (!device?.model) {
                continue;
            }
            const type = (0, device_models_1.deviceTypeForModel)(device.model);
            if (type === null) {
                continue;
            }
            total++;
            byType[type] = (byType[type] || 0) + 1;
            const service = this.getPrimaryService(accessory);
            if (service && service.getCharacteristic(hap.Characteristic.On).value === true) {
                on++;
            }
        }
        return { cloud: this.lastCloudDeviceCount, total, on, byType, stateless: this.lastStatelessCount, excluded: this.lastExcludedCount };
    }
    /**
     * Returns the primary controllable service for an accessory, if any.
     */
    getPrimaryService(accessory) {
        return (accessory.getService(hap.Service.Fan) ||
            accessory.getService(hap.Service.Lightbulb) ||
            accessory.getService(hap.Service.Switch) ||
            accessory.getService(hap.Service.Outlet) ||
            undefined);
    }
    /**
     * Emits a diagnostics report as a human-readable line plus structured JSON
     * fields (when structuredLogs is enabled). The report is already redacted.
     */
    emitDiagnostic(level, report) {
        const { lifecycle, ...groups } = report;
        const context = {
            ...groups,
            ...lifecycle,
        };
        this.log[level](formatDiagnosticLine(report), context);
    }
    /**
     * Removes all accessories
     */
    removeAccessories() {
        this.log.info('Removing all accessories');
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
        this.accessories.length = 0;
    }
}
exports.LevitonDecoraSmartPlatform = LevitonDecoraSmartPlatform;
/** Human-readable label for a diagnostics channel (structured JSON keeps `msg`). */
function diagnosticLabel(msg) {
    switch (msg) {
        case 'health':
            return 'Health';
        case 'diagnostics.start':
            return 'Diagnostics start';
        case 'diagnostics.stop':
            return 'Diagnostics stop';
        case 'health.degraded':
            return 'Health degraded';
        case 'health.recovered':
            return 'Health recovered';
        default:
            return msg;
    }
}
/**
 * Builds the concise human-readable summary line for a diagnostics report.
 */
function formatDiagnosticLine(report) {
    const { lifecycle, devices, websocket, api } = report;
    const reasonText = lifecycle.reasons.length > 0 ? ` [${lifecycle.reasons.join(', ')}]` : '';
    return (`${diagnosticLabel(report.msg)}: ${lifecycle.health}${reasonText} | ` +
        `devices ${devices.on}/${devices.total} on | ` +
        `ws ${websocket.state} | ` +
        `api p50 ${api.p50Ms}ms p95 ${api.p95Ms}ms (req ${api.requests}, err ${api.errors})`);
}
/**
 * Homebridge plugin registration
 */
function registerPlatform(homebridge) {
    hap = homebridge.hap;
    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, LevitonDecoraSmartPlatform, true);
}
exports.default = registerPlatform;
//# sourceMappingURL=platform.js.map