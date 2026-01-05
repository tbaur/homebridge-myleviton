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
// Plugin constants
const PLUGIN_NAME = 'homebridge-myleviton';
const PLATFORM_NAME = 'MyLevitonDecoraSmart';
const UUID_PREFIX = 'myleviton-';
// Power states
const POWER_ON = 'ON';
const POWER_OFF = 'OFF';
// Device model arrays for type checking
const DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL'];
const MOTION_DIMMER_MODELS = ['D2MSD'];
const OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P']; // D215P is plug-in switch
const SWITCH_MODELS = ['DW15S', 'D215S'];
const CONTROLLER_MODELS = ['DW4BC']; // Button controllers - no state, skip
const FAN_MODEL = 'DW4SF';
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
    currentToken = null;
    tokenRefreshInProgress = false;
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
     * Validates plugin configuration
     */
    validateConfig() {
        if (!this.config) {
            this.log.error(`No config for ${PLUGIN_NAME} defined.`);
            return false;
        }
        if (!this.config.email || !this.config.password) {
            this.log.error(`email and password for ${PLUGIN_NAME} are required in config.json`);
            return false;
        }
        if (typeof this.config.email !== 'string' || typeof this.config.password !== 'string') {
            this.log.error('email and password must be strings');
            return false;
        }
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(this.config.email)) {
            this.log.error(`Invalid email format: ${this.config.email}`);
            return false;
        }
        return true;
    }
    /**
     * Initializes the platform
     */
    async initialize() {
        this.log.info('Starting My Leviton Decora Smart platform...');
        try {
            const { devices, token, residenceId } = await this.discoverDevices();
            this.currentToken = token;
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
                    await this.addAccessory(device, token);
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
        const login = await this.client.login(this.config.email, this.config.password, debugLog);
        const token = login.id;
        const personId = login.userId;
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
        this.log.info('Connecting to real-time updates...');
        try {
            this.webSocket = (0, websocket_1.createWebSocket)(token, devices, this.handleWebSocketUpdate.bind(this), {
                debug: (msg) => this.log.debug(msg),
                info: (msg) => this.log.info(msg),
                warn: (msg) => this.log.warn(msg),
                error: (msg) => this.log.error(msg),
            });
        }
        catch (err) {
            this.log.warn(`Real-time updates unavailable: ${(0, sanitizers_1.sanitizeError)(err)}`);
        }
        return { devices, token, residenceId };
    }
    /**
     * Handles WebSocket update messages
     */
    handleWebSocketUpdate(payload) {
        if (!payload?.id) {
            this.log.warn('Received invalid WebSocket payload');
            return;
        }
        const accessory = this.accessories.find(acc => acc.context?.device?.id === payload.id);
        if (!accessory) {
            this.log.debug(`No accessory found for device ID: ${payload.id}`);
            return;
        }
        const { id, power, brightness, occupancy, motion } = payload;
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
        // Update brightness/rotation speed
        if (brightness !== undefined) {
            const clampedBrightness = Math.max(1, brightness);
            if (fanService) {
                fanService.getCharacteristic(hap.Characteristic.RotationSpeed).updateValue(clampedBrightness);
            }
            else if (lightService) {
                lightService.getCharacteristic(hap.Characteristic.Brightness).updateValue(clampedBrightness);
            }
        }
        // Update power state
        if (power !== undefined) {
            primaryService.getCharacteristic(hap.Characteristic.On).updateValue(power === POWER_ON);
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
        const token = accessory.context?.token;
        if (!device || !token) {
            this.log.error(`Missing device or token in accessory context: ${accessory.displayName}`);
            return;
        }
        const model = device.model || '';
        // Button controllers don't have controllable state - skip them
        if (CONTROLLER_MODELS.includes(model)) {
            this.log.debug(`Skipping controller device: ${device.name} (${model})`);
            return;
        }
        if (model === FAN_MODEL) {
            await this.setupFanService(accessory, device, token);
        }
        else if (MOTION_DIMMER_MODELS.includes(model)) {
            await this.setupMotionDimmerService(accessory, device, token);
        }
        else if (DIMMER_MODELS.includes(model)) {
            await this.setupLightbulbService(accessory, device, token);
        }
        else if (OUTLET_MODELS.includes(model)) {
            await this.setupBasicService(accessory, device, token, hap.Service.Outlet);
        }
        else if (SWITCH_MODELS.includes(model)) {
            await this.setupBasicService(accessory, device, token, hap.Service.Switch);
        }
        else {
            // Unknown model - treat as switch
            this.log.info(`Unknown device model '${model}' for ${device.name}, treating as switch`);
            await this.setupBasicService(accessory, device, token, hap.Service.Switch);
        }
    }
    /**
     * Gets device status with error handling
     */
    async getStatus(device, token) {
        try {
            return await this.client.getDeviceStatus(device.id, token);
        }
        catch (err) {
            this.log.error(`Failed to get status for ${device.name}: ${(0, sanitizers_1.sanitizeError)(err)}`);
            return { power: POWER_OFF, brightness: 0, minLevel: 1, maxLevel: 100 };
        }
    }
    /**
     * Sets up a lightbulb service
     */
    async setupLightbulbService(accessory, device, token) {
        const status = await this.getStatus(device, token);
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
        brightnessChar.on('get', this.createBrightnessGetter(device));
        brightnessChar.on('set', this.createBrightnessSetter(device));
        brightnessChar.updateValue(safeBrightness);
    }
    /**
     * Sets up a motion dimmer service
     */
    async setupMotionDimmerService(accessory, device, token) {
        await this.setupLightbulbService(accessory, device, token);
        const status = await this.getStatus(device, token);
        const motionService = accessory.getService(hap.Service.MotionSensor) ||
            accessory.addService(hap.Service.MotionSensor, `${device.name} Motion`);
        motionService
            .getCharacteristic(hap.Characteristic.MotionDetected)
            .updateValue(status.occupancy === true || status.motion === true);
    }
    /**
     * Sets up a fan service
     */
    async setupFanService(accessory, device, token) {
        const status = await this.getStatus(device, token);
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
        speedChar.on('get', this.createBrightnessGetter(device));
        speedChar.on('set', this.createBrightnessSetter(device));
        speedChar.updateValue(status.brightness || 0);
    }
    /**
     * Sets up a basic switch/outlet service
     */
    async setupBasicService(accessory, device, token, ServiceType) {
        const status = await this.getStatus(device, token);
        const service = accessory.getService(ServiceType, device.name) ||
            accessory.addService(ServiceType, device.name);
        service
            .getCharacteristic(hap.Characteristic.On)
            .on('get', this.createPowerGetter(device))
            .on('set', this.createPowerSetter(device))
            .updateValue(status.power === POWER_ON);
    }
    /**
     * Creates a power getter handler
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createPowerGetter(device) {
        return async (callback) => {
            try {
                const token = await this.ensureValidToken();
                const status = await this.client.getDeviceStatus(device.id, token);
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
                const token = await this.ensureValidToken();
                await this.client.setPower(device.id, token, value);
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
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createBrightnessGetter(device) {
        return async (callback) => {
            try {
                const token = await this.ensureValidToken();
                const status = await this.client.getDeviceStatus(device.id, token);
                callback(null, Math.max(1, status.brightness || 0));
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
                const token = await this.ensureValidToken();
                await this.client.setBrightness(device.id, token, value);
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
     * Ensures a valid token is available
     */
    async ensureValidToken() {
        if (this.currentToken) {
            return this.currentToken;
        }
        return this.refreshToken();
    }
    /**
     * Refreshes the authentication token
     */
    async refreshToken() {
        if (this.tokenRefreshInProgress) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return this.currentToken;
        }
        this.tokenRefreshInProgress = true;
        try {
            const login = await this.client.login(this.config.email, this.config.password);
            this.currentToken = login.id;
            // Update token in all accessory contexts
            this.accessories.forEach(acc => {
                if (acc.context) {
                    acc.context.token = this.currentToken;
                }
            });
            this.log.info('Token refreshed successfully');
            return this.currentToken;
        }
        finally {
            this.tokenRefreshInProgress = false;
        }
    }
    /**
     * Starts polling for device updates
     */
    startPolling() {
        const interval = Math.max((this.config.pollingInterval || 30) * 1000, 10000);
        this.log.info(`Starting device polling (every ${interval / 1000}s)`);
        this.pollingInterval = setInterval(() => this.pollDevices(), interval);
    }
    /**
     * Polls all devices for updates
     */
    async pollDevices() {
        if (!this.residenceId || !this.currentToken) {
            return;
        }
        try {
            const devices = await this.client.getDevices(this.residenceId, this.currentToken);
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