"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Input validation utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEmail = validateEmail;
exports.validatePassword = validatePassword;
exports.validateDeviceId = validateDeviceId;
exports.validateSerial = validateSerial;
exports.validateToken = validateToken;
exports.validatePowerState = validatePowerState;
exports.validateBrightness = validateBrightness;
exports.validateConfig = validateConfig;
exports.assertDefined = assertDefined;
exports.validateNonEmptyArray = validateNonEmptyArray;
const errors_1 = require("../errors");
/**
 * Email regex pattern
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Device ID pattern (alphanumeric)
 */
const DEVICE_ID_REGEX = /^[a-zA-Z0-9-]+$/;
/**
 * Serial number pattern
 */
const SERIAL_REGEX = /^[A-Za-z0-9]+$/;
/**
 * Validate email format
 */
function validateEmail(email) {
    if (!email || typeof email !== 'string') {
        throw new errors_1.ValidationError('email', 'must be a non-empty string');
    }
    const trimmed = email.trim();
    if (trimmed.length === 0) {
        throw new errors_1.ValidationError('email', 'cannot be empty');
    }
    if (trimmed.length > 254) {
        throw new errors_1.ValidationError('email', 'exceeds maximum length of 254 characters');
    }
    if (!EMAIL_REGEX.test(trimmed)) {
        throw new errors_1.ValidationError('email', 'invalid format');
    }
    return trimmed.toLowerCase();
}
/**
 * Validate password
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        throw new errors_1.ValidationError('password', 'must be a non-empty string');
    }
    if (password.length === 0) {
        throw new errors_1.ValidationError('password', 'cannot be empty');
    }
    if (password.length > 128) {
        throw new errors_1.ValidationError('password', 'exceeds maximum length of 128 characters');
    }
    return password;
}
/**
 * Validate device ID
 * Accepts strings or numbers (Leviton API returns numeric IDs)
 */
function validateDeviceId(id) {
    // Handle numeric IDs from API
    if (typeof id === 'number' && Number.isFinite(id)) {
        return String(id);
    }
    if (!id || typeof id !== 'string') {
        throw new errors_1.ValidationError('deviceId', 'must be a non-empty string or number');
    }
    const trimmed = id.trim();
    if (trimmed.length === 0) {
        throw new errors_1.ValidationError('deviceId', 'cannot be empty');
    }
    if (!DEVICE_ID_REGEX.test(trimmed)) {
        throw new errors_1.ValidationError('deviceId', 'contains invalid characters');
    }
    return trimmed;
}
/**
 * Validate device serial
 */
function validateSerial(serial) {
    if (!serial || typeof serial !== 'string') {
        throw new errors_1.ValidationError('serial', 'must be a non-empty string');
    }
    const trimmed = serial.trim();
    if (trimmed.length === 0) {
        throw new errors_1.ValidationError('serial', 'cannot be empty');
    }
    if (!SERIAL_REGEX.test(trimmed)) {
        throw new errors_1.ValidationError('serial', 'contains invalid characters');
    }
    return trimmed;
}
/**
 * Validate authentication token
 */
function validateToken(token) {
    if (!token || typeof token !== 'string') {
        throw new errors_1.ValidationError('token', 'must be a non-empty string');
    }
    const trimmed = token.trim();
    if (trimmed.length === 0) {
        throw new errors_1.ValidationError('token', 'cannot be empty');
    }
    return trimmed;
}
/**
 * Validate power state
 */
function validatePowerState(power) {
    if (power !== 'ON' && power !== 'OFF') {
        throw new errors_1.ValidationError('power', "must be 'ON' or 'OFF'", power);
    }
    return power;
}
/**
 * Validate brightness value (0-100)
 */
function validateBrightness(brightness) {
    if (typeof brightness !== 'number') {
        throw new errors_1.ValidationError('brightness', 'must be a number', brightness);
    }
    if (!Number.isFinite(brightness)) {
        throw new errors_1.ValidationError('brightness', 'must be a finite number', brightness);
    }
    if (brightness < 0 || brightness > 100) {
        throw new errors_1.ValidationError('brightness', 'must be between 0 and 100', brightness);
    }
    return Math.round(brightness);
}
/**
 * Validate plugin configuration
 */
function validateConfig(config) {
    const errors = [];
    if (!config || typeof config !== 'object') {
        throw new errors_1.ConfigurationError('Configuration must be an object');
    }
    const cfg = config;
    // Required fields
    if (!cfg.email) {
        errors.push('email is required');
    }
    else {
        try {
            validateEmail(cfg.email);
        }
        catch (e) {
            errors.push(`email: ${e.message}`);
        }
    }
    if (!cfg.password) {
        errors.push('password is required');
    }
    else {
        try {
            validatePassword(cfg.password);
        }
        catch (e) {
            errors.push(`password: ${e.message}`);
        }
    }
    // Optional fields
    if (cfg.loglevel !== undefined) {
        const validLevels = ['debug', 'info', 'warn', 'error'];
        if (!validLevels.includes(cfg.loglevel)) {
            errors.push(`loglevel must be one of: ${validLevels.join(', ')}`);
        }
    }
    if (cfg.excludedModels !== undefined) {
        if (!Array.isArray(cfg.excludedModels)) {
            errors.push('excludedModels must be an array');
        }
        else {
            cfg.excludedModels.forEach((model, i) => {
                if (typeof model !== 'string') {
                    errors.push(`excludedModels[${i}] must be a string`);
                }
            });
        }
    }
    if (cfg.excludedSerials !== undefined) {
        if (!Array.isArray(cfg.excludedSerials)) {
            errors.push('excludedSerials must be an array');
        }
        else {
            cfg.excludedSerials.forEach((serial, i) => {
                if (typeof serial !== 'string') {
                    errors.push(`excludedSerials[${i}] must be a string`);
                }
            });
        }
    }
    if (cfg.pollingInterval !== undefined) {
        const interval = cfg.pollingInterval;
        if (typeof interval !== 'number' || interval < 10 || interval > 3600) {
            errors.push('pollingInterval must be a number between 10 and 3600');
        }
    }
    if (cfg.connectionTimeout !== undefined) {
        const timeout = cfg.connectionTimeout;
        if (typeof timeout !== 'number' || timeout < 5000 || timeout > 60000) {
            errors.push('connectionTimeout must be a number between 5000 and 60000');
        }
    }
    if (errors.length > 0) {
        throw new errors_1.ConfigurationError(`Configuration validation failed: ${errors.join('; ')}`, undefined, errors);
    }
    return cfg;
}
/**
 * Validate that a value is defined (not null or undefined)
 */
function assertDefined(value, name) {
    if (value === null || value === undefined) {
        throw new errors_1.ValidationError(name, 'is required but was not provided');
    }
    return value;
}
/**
 * Validate that a value is a non-empty array
 */
function validateNonEmptyArray(arr, name) {
    if (!Array.isArray(arr)) {
        throw new errors_1.ValidationError(name, 'must be an array');
    }
    if (arr.length === 0) {
        throw new errors_1.ValidationError(name, 'cannot be empty');
    }
    return arr;
}
//# sourceMappingURL=validators.js.map