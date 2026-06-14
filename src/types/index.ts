/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

// Homebridge types - using minimal interface definitions
// Full types available when @types/homebridge is installed

/**
 * Logger interface compatible with Homebridge
 */
export interface Logger {
  info(message: string, ...parameters: unknown[]): void
  warn(message: string, ...parameters: unknown[]): void
  error(message: string, ...parameters: unknown[]): void
  debug(message: string, ...parameters: unknown[]): void
}

/**
 * Platform config interface
 */
export interface PlatformConfig {
  platform: string
  name?: string
  [key: string]: unknown
}

/**
 * Plugin configuration interface
 */
export interface LevitonConfig extends PlatformConfig {
  email: string
  password: string
  loglevel?: LogLevel
  excludedModels?: string[]
  excludedSerials?: string[]
  structuredLogs?: boolean
  pollInterval?: number
  pollingInterval?: number
  connectionTimeout?: number
  connectivitySensor?: boolean
  connectivitySensorName?: string
  /**
   * Diagnostics heartbeat interval in seconds. `0` (default) disables the
   * diagnostics subsystem entirely. Any other value must be between 30 and 3600.
   * Diagnostics are logs/JSON only and never surfaced in HomeKit.
   */
  diagnosticsInterval?: number
}

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Power states
 */
export type PowerState = 'ON' | 'OFF'

/**
 * Device model identifiers
 */
export enum DeviceModel {
  // Fan Controllers
  FAN = 'DW4SF',
  FAN_GEN2 = 'D24SF',  // 2nd Gen Fan Speed Controller
  
  // Dimmers
  DIMMER_VOICE = 'DWVAA',
  DIMMER_1000W = 'DW1KD',
  DIMMER_600W = 'DW6HD',
  DIMMER_600W_GEN2 = 'D26HD',
  DIMMER_PLUGIN_GEN2 = 'D23LP',
  DIMMER_PLUGIN = 'DW3HL',
  DIMMER_ELV = 'D2ELV',  // ELV/LED Phase Selectable Dimmer
  DIMMER_0_10V = 'D2710',  // 0-10V Dimmer Switch
  DIMMER_600W_GEN3 = 'DN6HD',  // 2nd Gen 600W Dimmer
  
  // Motion Sensor Dimmers
  DIMMER_MOTION = 'D2MSD',
  
  // Outlets
  OUTLET_TAMPER = 'DW15R',
  OUTLET_PLUGIN_HP = 'DW15A',
  OUTLET_PLUGIN = 'DW15P',
  OUTLET_OUTDOOR = 'D215O',
  
  // Switches
  SWITCH_15A = 'DW15S',
  SWITCH_15A_GEN2 = 'D215S',
}

/**
 * Device types for HomeKit service mapping
 */
export type DeviceType = 'fan' | 'dimmer' | 'motionDimmer' | 'outlet' | 'switch'

/**
 * Device information from Leviton API
 */
export interface DeviceInfo {
  id: string
  name: string
  serial: string
  model: string
  manufacturer?: string
  version?: string
}

/**
 * Device status from Leviton API
 */
export interface DeviceStatus {
  id?: string
  power: PowerState
  brightness?: number
  minLevel?: number
  maxLevel?: number
  occupancy?: boolean
  motion?: boolean
}

/**
 * Login response from Leviton API
 */
export interface LoginResponse {
  id: string  // Token
  userId: string
  ttl?: number
}

/**
 * Residential permission from Leviton API
 */
export interface ResidentialPermission {
  residentialAccountId: string
  [key: string]: unknown
}

/**
 * Residential account from Leviton API
 */
export interface ResidentialAccount {
  id: string
  primaryResidenceId: string
  [key: string]: unknown
}

/**
 * Residence from Leviton API v2
 */
export interface Residence {
  id: string
  [key: string]: unknown
}

/**
 * WebSocket message payload
 */
export interface WebSocketPayload {
  id: string
  power?: PowerState
  brightness?: number
  occupancy?: boolean
  motion?: boolean
}

/**
 * Cache entry structure
 */
export interface CacheEntry<T> {
  data: T
  timestamp: number
}

/**
 * Persisted device state
 */
export interface PersistedDeviceState {
  id: string
  name?: string
  model?: string
  power?: PowerState
  brightness?: number
  _cached?: boolean
  _cachedAt?: number
  _updatedAt?: number
}

/**
 * Persistence file structure
 */
export interface PersistenceFile {
  version: number
  timestamp: number
  devices: Record<string, PersistedDeviceState>
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
  retryableErrors: string[]
  onRetry?: (attempt: number, error: Error) => void
  /**
   * Optional custom predicate deciding whether an error is retryable. When
   * provided it fully replaces the default `isRetryableError`/`retryableErrors`
   * logic, giving callers precise control (e.g. retry only transient network
   * and 5xx errors, never auth or rate-limit errors).
   */
  shouldRetry?: (error: unknown) => boolean
}

/**
 * Request queue item
 */
export interface QueuedRequest<T = unknown> {
  id: string
  priority: 'high' | 'normal' | 'low'
  execute: () => Promise<T>
  timestamp: number
  resolve: (value: T) => void
  reject: (error: Error) => void
}

/**
 * Metrics data
 */
export interface Metrics {
  apiRequestsTotal: number
  apiRequestErrors: number
  cacheHits: number
  cacheMisses: number
  websocketReconnects: number
  circuitBreakerTrips: number
}

/**
 * A single diagnostics report (heartbeat or boot/shutdown snapshot).
 *
 * Counters (`reconnects`, `trips`, `throttled`, `refreshes`, polling `ok`/`failed`,
 * api `requests`/`errors`, and the `activity` group) are PER-INTERVAL DELTAS in a
 * heartbeat and SESSION CUMULATIVE totals in a snapshot. Everything else is an
 * absolute gauge read from in-memory state.
 */
export interface DiagnosticsSnapshot {
  /** Channel identifier, e.g. `health`, `diagnostics.start`, `diagnostics.stop`. */
  msg: string
  lifecycle: {
    health: 'healthy' | 'degraded'
    reasons: string[]
    uptimeSec: number
    pluginVersion: string
  }
  devices: {
    total: number
    on: number
    byType: Record<string, number>
    excluded: number
  }
  websocket: {
    state: string
    lastEventAgeSec: number | null
    subscribed: number
    reconnects: number
  }
  circuitBreaker: {
    state: string
    lastTripAt: number | null
    trips: number
  }
  rateLimiter: {
    available: number
    throttled: number
  }
  cache: {
    size: number
    hitRate: number
  }
  polling: {
    cadenceSec: number
    lastDurationMs: number | null
    ok: number
    failed: number
  }
  token: {
    expiresInSec: number | null
    lastRefreshAt: number | null
    refreshes: number
  }
  api: {
    p50Ms: number
    p95Ms: number
    requests: number
    errors: number
  }
  activity: {
    commandsSent: number
    externalChanges: number
    retries: number
  }
  /** Redacted config echo, present only on boot/shutdown snapshots. */
  config?: Record<string, unknown>
}

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: string
  level: LogLevel
  correlationId?: string
  deviceId?: string
  operation?: string
  duration?: number
  message: string
  error?: {
    code: string
    message: string
    stack?: string
  }
}

/**
 * API request options
 */
export interface ApiRequestOptions {
  useCache?: boolean
  cacheKey?: string
  bypassCircuitBreaker?: boolean
  debugLog?: (msg: string) => void
  priority?: 'high' | 'normal' | 'low'
}

/**
 * Accessory context stored in Homebridge
 */
export interface AccessoryContext {
  device: DeviceInfo
  token: string
}

