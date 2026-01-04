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
     * Make an API request with all protections
     */
    private request;
    /**
     * Execute the actual request
     */
    private executeRequest;
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