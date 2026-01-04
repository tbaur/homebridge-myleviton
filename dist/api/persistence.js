"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Device state persistence for faster startup and offline resilience
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
exports.DevicePersistence = exports.PERSISTENCE_FILE_NAME = exports.DEFAULT_PERSISTENCE_CONFIG = void 0;
exports.getDevicePersistence = getDevicePersistence;
exports.resetGlobalPersistence = resetGlobalPersistence;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Default persistence configuration
 */
exports.DEFAULT_PERSISTENCE_CONFIG = {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    maxDevices: 200,
};
/**
 * Default persistence file name
 */
exports.PERSISTENCE_FILE_NAME = '.homebridge-myleviton-state.json';
/**
 * Device state persistence manager
 * Stores device states for faster startup and offline resilience
 */
class DevicePersistence {
    storagePath;
    maxAge;
    maxDevices;
    deviceStates = new Map();
    loaded = false;
    dirty = false;
    constructor(storagePath, config = {}) {
        const merged = { ...exports.DEFAULT_PERSISTENCE_CONFIG, ...config };
        this.storagePath = storagePath || path.join(process.env.HOME || '/tmp', exports.PERSISTENCE_FILE_NAME);
        this.maxAge = merged.maxAge ?? 24 * 60 * 60 * 1000;
        this.maxDevices = merged.maxDevices ?? 200;
    }
    /**
     * Load persisted device states from disk
     */
    load() {
        if (this.loaded) {
            return this.deviceStates;
        }
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf8');
                const parsed = JSON.parse(data);
                // Validate structure
                if (parsed && typeof parsed === 'object' && parsed.devices) {
                    const now = Date.now();
                    const maxAge = this.maxAge;
                    for (const [id, state] of Object.entries(parsed.devices)) {
                        if (state && typeof state === 'object') {
                            // Check if data is too old
                            const cachedAt = parsed.timestamp || 0;
                            if (now - cachedAt < maxAge) {
                                this.deviceStates.set(id, {
                                    ...state,
                                    _cached: true,
                                    _cachedAt: cachedAt,
                                });
                            }
                        }
                    }
                }
            }
        }
        catch {
            // Ignore load errors - start fresh
            this.deviceStates.clear();
        }
        this.loaded = true;
        return this.deviceStates;
    }
    /**
     * Save device states to disk
     */
    save() {
        if (!this.dirty && this.loaded) {
            return true; // Nothing to save
        }
        try {
            // Clean up internal properties before saving
            const devices = {};
            // Limit size
            let count = 0;
            for (const [id, state] of this.deviceStates.entries()) {
                if (count >= this.maxDevices) {
                    break;
                }
                const { _cached, _cachedAt, _updatedAt, ...cleanState } = state;
                devices[id] = cleanState;
                count++;
            }
            const data = JSON.stringify({
                version: 1,
                timestamp: Date.now(),
                devices,
            }, null, 2);
            // Write atomically using temp file
            const tempPath = `${this.storagePath}.tmp`;
            fs.writeFileSync(tempPath, data, 'utf8');
            fs.renameSync(tempPath, this.storagePath);
            this.dirty = false;
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Update state for a device
     */
    updateDevice(deviceId, state) {
        if (!deviceId) {
            return;
        }
        const existing = this.deviceStates.get(deviceId) || { id: deviceId };
        this.deviceStates.set(deviceId, {
            ...existing,
            ...state,
            id: deviceId,
            _cached: false,
            _updatedAt: Date.now(),
        });
        this.dirty = true;
    }
    /**
     * Update device from API status
     */
    updateFromStatus(deviceId, status) {
        this.updateDevice(deviceId, {
            power: status.power,
            brightness: status.brightness,
        });
    }
    /**
     * Get cached state for a device
     */
    getDevice(deviceId) {
        this.load(); // Ensure loaded
        return this.deviceStates.get(deviceId) || null;
    }
    /**
     * Check if device has fresh cached data
     */
    hasFreshCache(deviceId, maxAge = this.maxAge) {
        const state = this.getDevice(deviceId);
        if (!state) {
            return false;
        }
        const updatedAt = state._updatedAt || state._cachedAt || 0;
        return Date.now() - updatedAt < maxAge;
    }
    /**
     * Get device status from cache (for fallback)
     */
    getCachedStatus(deviceId) {
        const state = this.getDevice(deviceId);
        if (!state || !state.power) {
            return null;
        }
        return {
            id: state.id,
            power: state.power,
            brightness: state.brightness,
        };
    }
    /**
     * Remove a device from persistence
     */
    removeDevice(deviceId) {
        const deleted = this.deviceStates.delete(deviceId);
        if (deleted) {
            this.dirty = true;
        }
        return deleted;
    }
    /**
     * Clear all persisted states
     */
    clear() {
        this.deviceStates.clear();
        this.dirty = true;
        try {
            if (fs.existsSync(this.storagePath)) {
                fs.unlinkSync(this.storagePath);
            }
        }
        catch {
            // Ignore delete errors
        }
    }
    /**
     * Get all cached device states
     */
    getAllDevices() {
        this.load();
        return new Map(this.deviceStates);
    }
    /**
     * Get device count
     */
    get size() {
        return this.deviceStates.size;
    }
    /**
     * Check if persistence has been modified
     */
    get isDirty() {
        return this.dirty;
    }
    /**
     * Get persistence statistics
     */
    getStats() {
        return {
            deviceCount: this.size,
            loaded: this.loaded,
            dirty: this.dirty,
            storagePath: this.storagePath,
        };
    }
}
exports.DevicePersistence = DevicePersistence;
/**
 * Global persistence instance
 */
let globalPersistence = null;
/**
 * Get or create the global persistence instance
 */
function getDevicePersistence(storagePath) {
    if (!globalPersistence) {
        globalPersistence = new DevicePersistence(storagePath);
    }
    return globalPersistence;
}
/**
 * Reset the global persistence (for testing)
 */
function resetGlobalPersistence() {
    globalPersistence = null;
}
//# sourceMappingURL=persistence.js.map