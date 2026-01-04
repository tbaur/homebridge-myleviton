/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Structured error hierarchy for better error handling
 */
/**
 * Base error class for all Leviton plugin errors
 */
export declare abstract class LevitonError extends Error {
    abstract code: string;
    abstract readonly isRetryable: boolean;
    readonly httpStatus?: number;
    readonly timestamp: Date;
    constructor(message: string, options?: {
        cause?: Error;
    });
    /**
     * Convert to JSON for logging
     */
    toJSON(): Record<string, unknown>;
}
/**
 * Authentication/authorization errors (401, 403)
 */
export declare class AuthenticationError extends LevitonError {
    code: string;
    readonly isRetryable = true;
    readonly httpStatus = 401;
    constructor(message?: string, options?: {
        cause?: Error;
    });
}
/**
 * Token expired error - specific case of auth error
 */
export declare class TokenExpiredError extends AuthenticationError {
    constructor(message?: string, options?: {
        cause?: Error;
    });
}
/**
 * Rate limiting errors (429)
 */
export declare class RateLimitError extends LevitonError {
    readonly code = "RATE_LIMITED";
    readonly isRetryable = true;
    readonly httpStatus = 429;
    readonly retryAfter: number;
    constructor(message?: string, retryAfter?: number, options?: {
        cause?: Error;
    });
}
/**
 * Device offline/unreachable errors
 */
export declare class DeviceOfflineError extends LevitonError {
    readonly code = "DEVICE_OFFLINE";
    readonly isRetryable = false;
    readonly deviceId: string;
    readonly deviceName?: string;
    constructor(deviceId: string, deviceName?: string, options?: {
        cause?: Error;
    });
}
/**
 * Device not found errors
 */
export declare class DeviceNotFoundError extends LevitonError {
    readonly code = "DEVICE_NOT_FOUND";
    readonly isRetryable = false;
    readonly httpStatus = 404;
    readonly deviceId: string;
    constructor(deviceId: string, options?: {
        cause?: Error;
    });
}
/**
 * Circuit breaker open errors
 */
export declare class CircuitBreakerError extends LevitonError {
    readonly code = "CIRCUIT_OPEN";
    readonly isRetryable = true;
    readonly resetTime: Date;
    constructor(resetTimeMs: number, options?: {
        cause?: Error;
    });
    get retryAfterMs(): number;
}
/**
 * Network/connectivity errors
 */
export declare class NetworkError extends LevitonError {
    code: string;
    readonly isRetryable = true;
    readonly originalError?: Error;
    constructor(message?: string, options?: {
        cause?: Error;
    });
}
/**
 * Request timeout errors
 */
export declare class TimeoutError extends NetworkError {
    readonly timeoutMs: number;
    constructor(timeoutMs: number, options?: {
        cause?: Error;
    });
}
/**
 * API response parsing errors
 */
export declare class ApiParseError extends LevitonError {
    readonly code = "PARSE_ERROR";
    readonly isRetryable = false;
    readonly responsePreview?: string;
    constructor(message: string, responsePreview?: string, options?: {
        cause?: Error;
    });
}
/**
 * Invalid API response errors
 */
export declare class ApiResponseError extends LevitonError {
    readonly code = "API_ERROR";
    readonly isRetryable: boolean;
    readonly httpStatus: number;
    readonly responseBody?: string;
    constructor(httpStatus: number, statusText: string, responseBody?: string, options?: {
        cause?: Error;
    });
}
/**
 * Configuration validation errors
 */
export declare class ConfigurationError extends LevitonError {
    readonly code = "CONFIG_ERROR";
    readonly isRetryable = false;
    readonly field?: string;
    readonly details?: string[];
    constructor(message: string, field?: string, details?: string[], options?: {
        cause?: Error;
    });
}
/**
 * Validation errors for input data
 */
export declare class ValidationError extends LevitonError {
    readonly code = "VALIDATION_ERROR";
    readonly isRetryable = false;
    readonly field: string;
    readonly value?: unknown;
    constructor(field: string, message: string, value?: unknown, options?: {
        cause?: Error;
    });
}
/**
 * WebSocket connection errors
 */
export declare class WebSocketError extends LevitonError {
    readonly code = "WEBSOCKET_ERROR";
    readonly isRetryable = true;
    readonly closeCode?: number;
    constructor(message: string, closeCode?: number, options?: {
        cause?: Error;
    });
}
/**
 * Error factory for creating appropriate error types from API responses
 */
export declare function createApiError(httpStatus: number, statusText: string, responseBody?: string): LevitonError;
/**
 * Check if an error is retryable
 */
export declare function isRetryableError(error: unknown): boolean;
/**
 * Get error code from any error
 */
export declare function getErrorCode(error: unknown): string;
//# sourceMappingURL=index.d.ts.map