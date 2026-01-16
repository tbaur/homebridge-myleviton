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
const logger_1 = require("./utils/logger");
const sanitizers_1 = require("./utils/sanitizers");
const validators_1 = require("./utils/validators");
const errors_1 = require("./errors");
// Plugin constants
const PLUGIN_NAME = 'homebridge-myleviton';
const PLATFORM_NAME = 'MyLevitonDecoraSmart';
const UUID_PREFIX = 'myleviton-';
// Power states
const POWER_ON = 'ON';
const POWER_OFF = 'OFF';
// Token refresh buffer (refresh a few minutes before expiry)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Device model arrays for type checking
const DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL', 'D2ELV', 'D2710'];
const MOTION_DIMMER_MODELS = ['D2MSD'];
const OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P', 'D215O']; // D215P is plug-in switch, D215O is outdoor plug-in switch
const SWITCH_MODELS = ['DW15S', 'D215S'];
const CONTROLLER_MODELS = ['DW4BC']; // Button controllers - no state, skip
const FAN_MODELS = ['DW4SF', 'D24SF']; // Fan speed controllers
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
    // WebSocket connection
    webSocket = null;
    // Polling
    pollingInterval = null;
    residenceId = null;
    // Device persistence
    devicePersistence;
    // Cleanup interval
    cleanupInterval = null;
    constructor(homebridgeLog, config, api) {
        this.config = config;
        this.api = api;
        // Setup logging with optional structured JSON output
        this.log = (0, logger_1.createStructuredLogger)(homebridgeLog, {
            structured: config?.structuredLogs || false,
            level: config?.loglevel || 'info',
        });
        // Setup API client
        this.client = (0, client_1.getApiClient)({
            timeout: config?.connectionTimeout || 10000,
        });
        // Setup device persistence
        const storagePath = api?.user?.storagePath?.()
            ? path.join(api.user.storagePath(), '.homebridge-myleviton-state.json')
            : undefined;
        this.devicePersistence = (0, persistence_1.getDevicePersistence)(storagePath);
        // Validate configuration
        if (!this.validateConfig()) {
            return;
        }
        // Initialize on Homebridge launch
        api.on('didFinishLaunching', async () => {
            await this.initialize();
        });
        // Cleanup on shutdown
        api.on('shutdown', () => {
            this.saveDeviceStates();
            this.cleanup();
        });
        // Start periodic cleanup
        this.startPeriodicCleanup();
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
     * Initializes the platform
     */
    async initialize() {
        this.log.info('Starting My Leviton Decora Smart platform...');
        try {
            const { devices, loginResponse, residenceId } = await this.discoverDevices();
            this.setLoginResponse(loginResponse);
            this.residenceId = residenceId;
            if (devices.length === 0) {
                this.log.error('No devices found in your My Leviton account');
                return;
            }
            // Get exclusion lists
            const excludedModels = (this.config.excludedModels || []).map(m => m.toUpperCase());
            const excludedSerials = (this.config.excludedSerials || []).map(s => s.toUpperCase());
            let newDevices = 0;
            let excludedCount = 0;
            let cachedCount = 0;
            for (const device of devices) {
                if (this.isDeviceExcluded(device, excludedModels, excludedSerials)) {
                    excludedCount++;
                }
                else if (this.accessoryExists(device)) {
                    cachedCount++;
                }
                else {
                    await this.addAccessory(device, loginResponse.id);
                    newDevices++;
                }
            }
            this.log.info(`Found ${devices.length} devices (${cachedCount} cached, ${newDevices} new, ${excludedCount} excluded)`);
            // Start polling
            this.startPolling();
            this.log.info('Platform ready');
        }
        catch (error) {
            this.log.error(`Failed to initialize: ${(0, sanitizers_1.sanitizeError)(error)}`);
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
        // Get residential permissions
        this.log.info('Loading residence information...');
        const permissions = await this.client.getResidentialPermissions(personId, token, debugLog);
        if (!permissions.length || !permissions[0].residentialAccountId) {
            throw new Error('No residential permissions found');
        }
        const accountId = permissions[0].residentialAccountId;
        // Get residential account
        const account = await this.client.getResidentialAccount(accountId, token, debugLog);
        if (!account.primaryResidenceId || !account.id) {
            throw new Error('Invalid residential account response');
        }
        let residenceId = account.primaryResidenceId;
        const residenceObjectId = account.id;
        // Get devices
        this.log.info('Discovering devices...');
        let devices = await this.client.getDevices(residenceId, token, debugLog);
        // Try v2 API if no devices found
        if (!devices.length) {
            this.log.debug('Trying alternate residence API...');
            const residences = await this.client.getResidences(residenceObjectId, token, debugLog);
            if (residences.length && residences[0].id) {
                residenceId = residences[0].id;
                devices = await this.client.getDevices(residenceId, token, debugLog);
            }
        }
        // Setup WebSocket for real-time updates
        try {
            this.webSocket = (0, websocket_1.createWebSocket)(loginResponse, devices, this.handleWebSocketUpdate.bind(this), {
                debug: (msg) => this.log.debug(msg),
                info: (msg) => this.log.info(msg),
                warn: (msg) => this.log.warn(msg),
                error: (msg) => this.log.error(msg),
            }, {
                connectionTimeout: this.config.connectionTimeout,
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
            else {
                return;
            }
            // Log brightness change if different
            if (currentBrightness !== undefined && currentBrightness !== newBrightness) {
                this.log.info(`${accessory.displayName}: ${newBrightness}% (external)`, {
                    deviceId: device?.id,
                    operation: 'externalBrightnessUpdate',
                    brightness: newBrightness,
                });
            }
        }
        // Update power state
        if (power !== undefined) {
            const newPowerBool = power === POWER_ON;
            primaryService.getCharacteristic(hap.Characteristic.On).updateValue(newPowerBool);
            // Log power change if different
            if (currentPowerState !== power) {
                this.log.info(`${accessory.displayName}: ${power} (external)`, {
                    deviceId: device?.id,
                    operation: 'externalPowerUpdate',
                    power,
                });
            }
        }
        // Update motion sensor
        const motionService = accessory.getService(hap.Service.MotionSensor);
        if (motionService && (occupancy !== undefined || motion !== undefined)) {
            const motionDetected = occupancy === true || motion === true;
            motionService.getCharacteristic(hap.Characteristic.MotionDetected).updateValue(motionDetected);
        }
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
     * Checks if accessory already exists
     */
    accessoryExists(device) {
        return this.accessories.some(acc => acc.context?.device?.serial === device.serial);
    }
    /**
     * Adds a new accessory
     */
    async addAccessory(device, token) {
        if (!device?.serial || !device?.name) {
            this.log.error('Invalid device object provided to addAccessory');
            return;
        }
        this.log.info(`Adding device: ${device.name} (${device.model})`);
        const uuid = hap.uuid.generate(UUID_PREFIX + device.serial);
        const accessory = new this.api.platformAccessory(device.name, uuid);
        accessory.context = { device, token };
        // Set device info
        const infoService = accessory.getService(hap.Service.AccessoryInformation);
        if (infoService) {
            infoService
                .setCharacteristic(hap.Characteristic.Name, device.name || 'Unknown Device')
                .setCharacteristic(hap.Characteristic.SerialNumber, device.serial || 'Unknown')
                .setCharacteristic(hap.Characteristic.Manufacturer, device.manufacturer || 'Leviton')
                .setCharacteristic(hap.Characteristic.Model, device.model || 'Unknown')
                .setCharacteristic(hap.Characteristic.FirmwareRevision, device.version || 'Unknown');
        }
        // Setup service
        await this.setupService(accessory);
        // Register with Homebridge
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
    }
    /**
     * Configures a cached accessory
     */
    async configureAccessory(accessory) {
        this.log.debug(`Configuring cached accessory: ${accessory.displayName}`);
        await this.setupService(accessory);
        this.accessories.push(accessory);
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
        if (CONTROLLER_MODELS.includes(model)) {
            this.log.debug(`Skipping controller device: ${device.name} (${model})`);
            return;
        }
        if (FAN_MODELS.includes(model)) {
            await this.setupFanService(accessory, device);
        }
        else if (MOTION_DIMMER_MODELS.includes(model)) {
            await this.setupMotionDimmerService(accessory, device);
        }
        else if (DIMMER_MODELS.includes(model)) {
            await this.setupLightbulbService(accessory, device);
        }
        else if (OUTLET_MODELS.includes(model)) {
            await this.setupBasicService(accessory, device, hap.Service.Outlet);
        }
        else if (SWITCH_MODELS.includes(model)) {
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
    async getStatus(device) {
        try {
            return await this.withTokenRetry(async () => {
                const token = await this.ensureValidToken();
                return this.client.getDeviceStatus(device.id, token);
            });
        }
        catch (err) {
            this.log.error(`Failed to get status for ${device.name}: ${(0, sanitizers_1.sanitizeError)(err)}`);
            return { power: POWER_OFF, brightness: 0, minLevel: 1, maxLevel: 100 };
        }
    }
    /**
     * Sets up a lightbulb service
     */
    async setupLightbulbService(accessory, device) {
        const status = await this.getStatus(device);
        const service = accessory.getService(hap.Service.Lightbulb, device.name) ||
            accessory.addService(hap.Service.Lightbulb, device.name);
        // Calculate valid brightness range
        const minBrightness = status.minLevel || 1;
        const maxBrightness = status.maxLevel || 100;
        // Ensure brightness is within valid range (0 is invalid for HomeKit Brightness which has minValue=1)
        const rawBrightness = typeof status.brightness === 'number' ? status.brightness : 0;
        const safeBrightness = rawBrightness < minBrightness ? minBrightness : rawBrightness;
        // Setup On characteristic
        const onChar = service.getCharacteristic(hap.Characteristic.On);
        onChar.removeAllListeners('get');
        onChar.removeAllListeners('set');
        onChar.on('get', this.createPowerGetter(device));
        onChar.on('set', this.createPowerSetter(device));
        onChar.updateValue(status.power === POWER_ON);
        // Setup Brightness characteristic
        // Use getCharacteristic which always returns a valid Characteristic object
        const brightnessChar = service.getCharacteristic(hap.Characteristic.Brightness);
        // Set props first to establish valid range, then update value
        brightnessChar.setProps({ minValue: minBrightness, maxValue: maxBrightness, minStep: 1 });
        brightnessChar.removeAllListeners('get');
        brightnessChar.removeAllListeners('set');
        brightnessChar.on('get', this.createBrightnessGetter(device, minBrightness));
        brightnessChar.on('set', this.createBrightnessSetter(device));
        brightnessChar.updateValue(safeBrightness);
    }
    /**
     * Sets up a motion dimmer service
     */
    async setupMotionDimmerService(accessory, device) {
        await this.setupLightbulbService(accessory, device);
        const status = await this.getStatus(device);
        const motionService = accessory.getService(hap.Service.MotionSensor) ||
            accessory.addService(hap.Service.MotionSensor, `${device.name} Motion`);
        motionService
            .getCharacteristic(hap.Characteristic.MotionDetected)
            .updateValue(status.occupancy === true || status.motion === true);
    }
    /**
     * Sets up a fan service
     */
    async setupFanService(accessory, device) {
        const status = await this.getStatus(device);
        const service = accessory.getService(hap.Service.Fan, device.name) ||
            accessory.addService(hap.Service.Fan, device.name);
        // Setup On characteristic
        const onChar = service.getCharacteristic(hap.Characteristic.On);
        onChar.removeAllListeners('get');
        onChar.removeAllListeners('set');
        onChar.on('get', this.createPowerGetter(device));
        onChar.on('set', this.createPowerSetter(device));
        onChar.updateValue(status.power === POWER_ON);
        // Setup RotationSpeed characteristic - set props before value
        const speedChar = service.getCharacteristic(hap.Characteristic.RotationSpeed);
        speedChar.setProps({ minValue: 0, maxValue: status.maxLevel || 100, minStep: status.minLevel || 1 });
        speedChar.removeAllListeners('get');
        speedChar.removeAllListeners('set');
        speedChar.on('get', this.createBrightnessGetter(device, 0)); // Fans allow 0
        speedChar.on('set', this.createBrightnessSetter(device));
        speedChar.updateValue(status.brightness || 0);
    }
    /**
     * Sets up a basic switch/outlet service
     */
    async setupBasicService(accessory, device, ServiceType) {
        const status = await this.getStatus(device);
        const service = accessory.getService(ServiceType, device.name) ||
            accessory.addService(ServiceType, device.name);
        // Remove existing listeners to prevent stacking on cached accessories
        const onChar = service.getCharacteristic(hap.Characteristic.On);
        onChar.removeAllListeners('get');
        onChar.removeAllListeners('set');
        onChar.on('get', this.createPowerGetter(device));
        onChar.on('set', this.createPowerSetter(device));
        onChar.updateValue(status.power === POWER_ON);
    }
    /**
     * Creates a power getter handler
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createPowerGetter(device) {
        return async (callback) => {
            try {
                const status = await this.withTokenRetry(async () => {
                    const token = await this.ensureValidToken();
                    return this.client.getDeviceStatus(device.id, token);
                });
                callback(null, status.power === POWER_ON);
            }
            catch (err) {
                callback(new Error((0, sanitizers_1.sanitizeError)(err)));
            }
        };
    }
    /**
     * Creates a power setter handler
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createPowerSetter(device) {
        return async (value, callback) => {
            const startTime = Date.now();
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
                callback(new Error((0, sanitizers_1.sanitizeError)(err)));
            }
        };
    }
    /**
     * Creates a brightness getter handler
     * @param device - Device info
     * @param minValue - Minimum brightness value (0 for fans, 1 for dimmers)
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createBrightnessGetter(device, minValue = 1) {
        return async (callback) => {
            try {
                const status = await this.withTokenRetry(async () => {
                    const token = await this.ensureValidToken();
                    return this.client.getDeviceStatus(device.id, token);
                });
                callback(null, Math.max(minValue, status.brightness ?? 0));
            }
            catch (err) {
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
            this.tokenExpiresAt = null;
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
                return operation();
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
        this.tokenRefreshPromise = (async () => {
            const loginResponse = await this.client.login(this.config.email, this.config.password);
            this.setLoginResponse(loginResponse);
            // Update token in all accessory contexts
            this.accessories.forEach(acc => {
                if (acc.context) {
                    acc.context.token = loginResponse.id;
                }
            });
            // Update WebSocket with new login response
            if (this.webSocket) {
                this.webSocket.updateLoginResponse(loginResponse);
                this.webSocket.connect();
            }
            this.log.info('Token refreshed successfully');
            return loginResponse;
        })();
        try {
            return await this.tokenRefreshPromise;
        }
        finally {
            this.tokenRefreshPromise = null;
        }
    }
    /**
     * Starts polling for device updates
     */
    startPolling() {
        const intervalSeconds = this.config.pollInterval ?? this.config.pollingInterval ?? 30;
        const interval = Math.max(intervalSeconds * 1000, 10000);
        this.pollingInterval = setInterval(() => this.pollDevices(), interval);
    }
    /**
     * Polls all devices for updates
     */
    async pollDevices() {
        if (!this.residenceId) {
            return;
        }
        try {
            const devices = await this.withTokenRetry(async () => {
                const token = await this.ensureValidToken();
                return this.client.getDevices(this.residenceId, token);
            });
            for (const device of devices) {
                if (device?.id) {
                    this.handleWebSocketUpdate({
                        id: device.id,
                        power: device.power,
                        brightness: device.brightness,
                    });
                }
            }
        }
        catch (err) {
            this.log.debug(`Polling error: ${(0, sanitizers_1.sanitizeError)(err)}`);
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
                        this.devicePersistence.updateDevice(device.id, {
                            id: device.id,
                            name: device.name,
                            model: device.model,
                            power: isOn ? POWER_ON : POWER_OFF,
                        });
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
     * Starts periodic cleanup
     */
    startPeriodicCleanup() {
        this.cleanupInterval = setInterval(() => {
            this.client.clearCache();
        }, 60000);
    }
    /**
     * Cleans up resources
     */
    cleanup() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.webSocket) {
            this.webSocket.close();
            this.webSocket = null;
        }
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
/**
 * Homebridge plugin registration
 */
function registerPlatform(homebridge) {
    hap = homebridge.hap;
    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, LevitonDecoraSmartPlatform, true);
}
exports.default = registerPlatform;
//# sourceMappingURL=platform.js.map