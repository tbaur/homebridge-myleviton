/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */
/**
 * Logger interface compatible with Homebridge
 */
export interface Logger {
    info(message: string, ...parameters: unknown[]): void;
    warn(message: string, ...parameters: unknown[]): void;
    error(message: string, ...parameters: unknown[]): void;
    debug(message: string, ...parameters: unknown[]): void;
}
/**
 * Platform config interface
 */
export interface PlatformConfig {
    platform: string;
    name?: string;
    [key: string]: unknown;
}
/**
 * Plugin configuration interface
 */
export interface LevitonConfig extends PlatformConfig {
    email: string;
    password: string;
    loglevel?: LogLevel;
    excludedModels?: string[];
    excludedSerials?: string[];
    structuredLogs?: boolean;
    pollingInterval?: number;
    connectionTimeout?: number;
}
/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
/**
 * Power states
 */
export type PowerState = 'ON' | 'OFF';
/**
 * Device model identifiers
 */
export declare enum DeviceModel {
    FAN = "DW4SF",
    DIMMER_VOICE = "DWVAA",
    DIMMER_1000W = "DW1KD",
    DIMMER_600W = "DW6HD",
    DIMMER_600W_GEN2 = "D26HD",
    DIMMER_PLUGIN_GEN2 = "D23LP",
    DIMMER_PLUGIN = "DW3HL",
    DIMMER_MOTION = "D2MSD",
    OUTLET_TAMPER = "DW15R",
    OUTLET_PLUGIN_HP = "DW15A",
    OUTLET_PLUGIN = "DW15P",
    OUTLET_OUTDOOR = "D215O",
    SWITCH_15A = "DW15S",
    SWITCH_15A_GEN2 = "D215S"
}
/**
 * Device types for HomeKit service mapping
 */
export type DeviceType = 'fan' | 'dimmer' | 'motionDimmer' | 'outlet' | 'switch';
/**
 * Device information from Leviton API
 */
export interface DeviceInfo {
    id: string;
    name: string;
    serial: string;
    model: string;
    manufacturer?: string;
    version?: string;
}
/**
 * Device status from Leviton API
 */
export interface DeviceStatus {
    id?: string;
    power: PowerState;
    brightness?: number;
    minLevel?: number;
    maxLevel?: number;
    occupancy?: boolean;
    motion?: boolean;
}
/**
 * Login response from Leviton API
 */
export interface LoginResponse {
    id: string;
    userId: string;
    ttl?: number;
}
/**
 * Residential permission from Leviton API
 */
export interface ResidentialPermission {
    residentialAccountId: string;
    [key: string]: unknown;
}
/**
 * Residential account from Leviton API
 */
export interface ResidentialAccount {
    id: string;
    primaryResidenceId: string;
    [key: string]: unknown;
}
/**
 * Residence from Leviton API v2
 */
export interface Residence {
    id: string;
    [key: string]: unknown;
}
/**
 * WebSocket message payload
 */
export interface WebSocketPayload {
    id: string;
    power?: PowerState;
    brightness?: number;
    occupancy?: boolean;
    motion?: boolean;
}
/**
 * Cache entry structure
 */
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
}
/**
 * Persisted device state
 */
export interface PersistedDeviceState {
    id: string;
    name?: string;
    model?: string;
    power?: PowerState;
    brightness?: number;
    _cached?: boolean;
    _cachedAt?: number;
    _updatedAt?: number;
}
/**
 * Persistence file structure
 */
export interface PersistenceFile {
    version: number;
    timestamp: number;
    devices: Record<string, PersistedDeviceState>;
}
/**
 * Retry policy configuration
 */
export interface RetryPolicy {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    retryableErrors: string[];
    onRetry?: (attempt: number, error: Error) => void;
}
/**
 * Request queue item
 */
export interface QueuedRequest<T = unknown> {
    id: string;
    priority: 'high' | 'normal' | 'low';
    execute: () => Promise<T>;
    timestamp: number;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}
/**
 * Metrics data
 */
export interface Metrics {
    apiRequestsTotal: number;
    apiRequestErrors: number;
    cacheHits: number;
    cacheMisses: number;
    websocketReconnects: number;
    circuitBreakerTrips: number;
}
/**
 * Structured log entry
 */
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    correlationId?: string;
    deviceId?: string;
    operation?: string;
    duration?: number;
    message: string;
    error?: {
        code: string;
        message: string;
        stack?: string;
    };
}
/**
 * API request options
 */
export interface ApiRequestOptions {
    useCache?: boolean;
    cacheKey?: string;
    bypassCircuitBreaker?: boolean;
    debugLog?: (msg: string) => void;
    priority?: 'high' | 'normal' | 'low';
}
/**
 * Accessory context stored in Homebridge
 */
export interface AccessoryContext {
    device: DeviceInfo;
    token: string;
}
//# sourceMappingURL=index.d.ts.map