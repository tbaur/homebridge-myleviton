"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Structured error hierarchy for better error handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketError = exports.ValidationError = exports.ConfigurationError = exports.ApiResponseError = exports.ApiParseError = exports.TimeoutError = exports.NetworkError = exports.CircuitBreakerError = exports.DeviceNotFoundError = exports.DeviceOfflineError = exports.RateLimitError = exports.TokenExpiredError = exports.AuthenticationError = exports.LevitonError = void 0;
exports.createApiError = createApiError;
exports.isRetryableError = isRetryableError;
exports.getErrorCode = getErrorCode;
/**
 * Base error class for all Leviton plugin errors
 */
class LevitonError extends Error {
    httpStatus;
    timestamp;
    constructor(message, options) {
        super(message, options);
        this.name = this.constructor.name;
        this.timestamp = new Date();
        // Capture stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
    /**
     * Convert to JSON for logging
     */
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            isRetryable: this.isRetryable,
            httpStatus: this.httpStatus,
            timestamp: this.timestamp.toISOString(),
            stack: this.stack,
        };
    }
}
exports.LevitonError = LevitonError;
/**
 * Authentication/authorization errors (401, 403)
 */
class AuthenticationError extends LevitonError {
    code = 'AUTH_ERROR';
    isRetryable = true;
    httpStatus = 401;
    constructor(message = 'Authentication failed', options) {
        super(message, options);
    }
}
exports.AuthenticationError = AuthenticationError;
/**
 * Token expired error - specific case of auth error
 */
class TokenExpiredError extends AuthenticationError {
    constructor(message = 'Authentication token has expired', options) {
        super(message, options);
        this.code = 'TOKEN_EXPIRED';
    }
}
exports.TokenExpiredError = TokenExpiredError;
/**
 * Rate limiting errors (429)
 */
class RateLimitError extends LevitonError {
    code = 'RATE_LIMITED';
    isRetryable = true;
    httpStatus = 429;
    retryAfter;
    constructor(message = 'Rate limit exceeded', retryAfter = 60, options) {
        super(message, options);
        this.retryAfter = retryAfter;
    }
}
exports.RateLimitError = RateLimitError;
/**
 * Device offline/unreachable errors
 */
class DeviceOfflineError extends LevitonError {
    code = 'DEVICE_OFFLINE';
    isRetryable = false;
    deviceId;
    deviceName;
    constructor(deviceId, deviceName, options) {
        super(`Device ${deviceName || deviceId} is offline or unreachable`, options);
        this.deviceId = deviceId;
        this.deviceName = deviceName;
    }
}
exports.DeviceOfflineError = DeviceOfflineError;
/**
 * Device not found errors
 */
class DeviceNotFoundError extends LevitonError {
    code = 'DEVICE_NOT_FOUND';
    isRetryable = false;
    httpStatus = 404;
    deviceId;
    constructor(deviceId, options) {
        super(`Device ${deviceId} not found`, options);
        this.deviceId = deviceId;
    }
}
exports.DeviceNotFoundError = DeviceNotFoundError;
/**
 * Circuit breaker open errors
 */
class CircuitBreakerError extends LevitonError {
    code = 'CIRCUIT_OPEN';
    isRetryable = true;
    resetTime;
    constructor(resetTimeMs, options) {
        const resetTime = new Date(Date.now() + resetTimeMs);
        super(`Circuit breaker is open. Service unavailable until ${resetTime.toISOString()}`, options);
        this.resetTime = resetTime;
    }
    get retryAfterMs() {
        return Math.max(0, this.resetTime.getTime() - Date.now());
    }
}
exports.CircuitBreakerError = CircuitBreakerError;
/**
 * Network/connectivity errors
 */
class NetworkError extends LevitonError {
    code = 'NETWORK_ERROR';
    isRetryable = true;
    originalError;
    constructor(message = 'Network request failed', options) {
        super(message, options);
        this.originalError = options?.cause;
    }
}
exports.NetworkError = NetworkError;
/**
 * Request timeout errors
 */
class TimeoutError extends NetworkError {
    timeoutMs;
    constructor(timeoutMs, options) {
        super(`Request timed out after ${timeoutMs}ms`, options);
        this.code = 'TIMEOUT';
        this.timeoutMs = timeoutMs;
    }
}
exports.TimeoutError = TimeoutError;
/**
 * API response parsing errors
 */
class ApiParseError extends LevitonError {
    code = 'PARSE_ERROR';
    isRetryable = false;
    responsePreview;
    constructor(message, responsePreview, options) {
        super(message, options);
        this.responsePreview = responsePreview?.substring(0, 200);
    }
}
exports.ApiParseError = ApiParseError;
/**
 * Invalid API response errors
 */
class ApiResponseError extends LevitonError {
    code = 'API_ERROR';
    isRetryable;
    httpStatus;
    responseBody;
    constructor(httpStatus, statusText, responseBody, options) {
        super(`API request failed: ${httpStatus} ${statusText}`, options);
        this.httpStatus = httpStatus;
        this.responseBody = responseBody?.substring(0, 500);
        // Server errors (5xx) are retryable, client errors (4xx) are not
        this.isRetryable = httpStatus >= 500 && httpStatus < 600;
    }
}
exports.ApiResponseError = ApiResponseError;
/**
 * Configuration validation errors
 */
class ConfigurationError extends LevitonError {
    code = 'CONFIG_ERROR';
    isRetryable = false;
    field;
    details;
    constructor(message, field, details, options) {
        super(message, options);
        this.field = field;
        this.details = details;
    }
}
exports.ConfigurationError = ConfigurationError;
/**
 * Validation errors for input data
 */
class ValidationError extends LevitonError {
    code = 'VALIDATION_ERROR';
    isRetryable = false;
    field;
    value;
    constructor(field, message, value, options) {
        super(`Invalid ${field}: ${message}`, options);
        this.field = field;
        this.value = value;
    }
}
exports.ValidationError = ValidationError;
/**
 * WebSocket connection errors
 */
class WebSocketError extends LevitonError {
    code = 'WEBSOCKET_ERROR';
    isRetryable = true;
    closeCode;
    constructor(message, closeCode, options) {
        super(message, options);
        this.closeCode = closeCode;
    }
}
exports.WebSocketError = WebSocketError;
/**
 * Error factory for creating appropriate error types from API responses
 */
function createApiError(httpStatus, statusText, responseBody) {
    switch (httpStatus) {
        case 401:
            return new AuthenticationError(`Unauthorized: ${statusText}`);
        case 403:
            return new AuthenticationError(`Forbidden: ${statusText}`);
        case 404:
            return new ApiResponseError(httpStatus, statusText, responseBody);
        case 429:
            return new RateLimitError(`Rate limited: ${statusText}`);
        default:
            return new ApiResponseError(httpStatus, statusText, responseBody);
    }
}
/**
 * Check if an error is retryable
 */
function isRetryableError(error) {
    if (error instanceof LevitonError) {
        return error.isRetryable;
    }
    // Network errors from fetch are generally retryable
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return (message.includes('network') ||
            message.includes('timeout') ||
            message.includes('econnreset') ||
            message.includes('enotfound') ||
            message.includes('socket hang up'));
    }
    return false;
}
/**
 * Get error code from any error
 */
function getErrorCode(error) {
    if (error instanceof LevitonError) {
        return error.code;
    }
    if (error instanceof Error) {
        return error.name || 'UNKNOWN_ERROR';
    }
    return 'UNKNOWN_ERROR';
}
//# sourceMappingURL=index.js.map