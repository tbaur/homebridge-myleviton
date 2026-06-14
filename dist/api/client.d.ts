/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Leviton API HTTP client
 */
import { RateLimiter } from './rate-limiter';
import { CircuitBreaker } from './circuit-breaker';
import { ResponseCache } from './cache';
import type { DeviceInfo, DeviceStatus, LoginResponse, ResidentialPermission, ResidentialAccount, Residence, PowerState } from '../types';
/**
 * Minimal logger surface used by the client for resilience observability.
 * Optional methods so a partial logger (or none) can be supplied.
 */
export interface ClientLogger {
    debug?: (message: string) => void;
    info?: (message: string) => void;
    warn?: (message: string) => void;
}
/**
 * A single request measurement reported to the optional `metrics` hook.
 */
export interface RequestMetric {
    /** Wall-clock duration of the logical request in milliseconds. */
    durationMs: number;
    /** Whether the request ultimately succeeded. */
    ok: boolean;
}
/**
 * API configuration
 */
export interface ApiClientConfig {
    /** Base URL for Leviton API */
    baseUrl: string;
    /** Request timeout in ms */
    timeout: number;
    /** Whether to use response caching */
    useCache: boolean;
    /** Cache TTL in ms */
    cacheTtl: number;
    /** Maximum attempts for transient (network/5xx) failures before giving up */
    maxRetryAttempts: number;
    /** Optional logger for resilience events (circuit breaker, rate limiting) */
    logger?: ClientLogger;
    /**
     * Optional metrics hook fired around EVERY logical request, including
     * timeouts, network errors, circuit-breaker rejections, and rate-limit
     * rejections. Cache hits are not reported (no request is made).
     */
    metrics?: (sample: RequestMetric) => void;
}
/**
 * Default API configuration
 */
export declare const DEFAULT_API_CONFIG: ApiClientConfig;
/**
 * Leviton API client
 */
export declare class LevitonApiClient {
    private readonly config;
    private readonly rateLimiter;
    private readonly circuitBreaker;
    private readonly cache;
    private readonly deduplicator;
    constructor(config?: Partial<ApiClientConfig>);
    /**
     * Surface circuit-breaker transitions so operators can see when the Leviton
     * API is being treated as unavailable and when it recovers.
     */
    private logCircuitTransition;
    /**
     * Make an API request with all protections
     */
    private request;
    /**
     * Execute the actual request, reporting a metrics sample around the full
     * logical request (including breaker/rate-limit rejections, timeouts, and
     * errors) when a `metrics` hook is configured.
     */
    private executeRequest;
    /**
     * Run a single logical request with circuit breaker, rate limiting, retry,
     * and caching protections.
     */
    private runRequest;
    /**
     * Performs a single fetch + parse cycle, translating low-level failures into
     * typed errors. Intentionally free of circuit-breaker, rate-limit, and cache
     * side effects so it can be safely retried.
     */
    private fetchAndParse;
    /**
     * Login and get authentication token
     */
    login(email: string, password: string, debugLog?: (msg: string) => void): Promise<LoginResponse>;
    /**
     * Get residential permissions for a person
     */
    getResidentialPermissions(personId: string, token: string, debugLog?: (msg: string) => void): Promise<ResidentialPermission[]>;
    /**
     * Get residential account details
     */
    getResidentialAccount(accountId: string, token: string, debugLog?: (msg: string) => void): Promise<ResidentialAccount>;
    /**
     * Get residences using v2 API
     */
    getResidences(residenceObjectId: string, token: string, debugLog?: (msg: string) => void): Promise<Residence[]>;
    /**
     * Get IoT switches for a residence
     */
    getDevices(residenceId: string, token: string, debugLog?: (msg: string) => void): Promise<DeviceInfo[]>;
    /**
     * Get status of a specific device
     */
    getDeviceStatus(deviceId: string, token: string, debugLog?: (msg: string) => void): Promise<DeviceStatus>;
    /**
     * Update device state
     */
    setDeviceState(deviceId: string, token: string, state: {
        power?: PowerState;
        brightness?: number;
    }, debugLog?: (msg: string) => void): Promise<DeviceStatus>;
    /**
     * Set device power
     */
    setPower(deviceId: string, token: string, power: boolean, debugLog?: (msg: string) => void): Promise<DeviceStatus>;
    /**
     * Set device brightness
     */
    setBrightness(deviceId: string, token: string, brightness: number, debugLog?: (msg: string) => void): Promise<DeviceStatus>;
    /**
     * Clear response cache
     */
    clearCache(): void;
    /**
     * Invalidate cache for a specific device
     */
    invalidateDeviceCache(deviceId: string): void;
    /**
     * Get client status
     */
    getStatus(): {
        circuitBreaker: ReturnType<CircuitBreaker['getStatus']>;
        rateLimiter: ReturnType<RateLimiter['getStatus']>;
        cache: ReturnType<ResponseCache['getStats']>;
    };
    /**
     * Reset all client state (for testing)
     */
    reset(): void;
}
/**
 * Get or create the global API client
 */
export declare function getApiClient(config?: Partial<ApiClientConfig>): LevitonApiClient;
/**
 * Reset the global client (for testing)
 */
export declare function resetGlobalClient(): void;
//# sourceMappingURL=client.d.ts.map