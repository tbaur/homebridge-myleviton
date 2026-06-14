/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Opt-in diagnostics collector for health/activity metrics.
 *
 * One collector is owned per platform instance (account isolation, mirroring the
 * per-instance client/breaker/limiter/cache). It accumulates cumulative counters
 * and a bounded latency window, and turns them into:
 *   - `buildHeartbeat()`  — per-interval counter deltas + absolute gauges
 *   - `snapshot()`        — session cumulative totals + redacted config echo
 *   - `rollup()`          — `{ health, reasons[] }` health classification
 *
 * It only ever reads in-memory state via the supplied `readers`; it never
 * performs any network I/O.
 */

import type { DiagnosticsSnapshot, LevitonConfig } from '../types'

/** Maximum number of recent request latencies retained for percentile math. */
const LATENCY_WINDOW = 200

/** Recent request outcomes retained for the rollup error-rate calculation. */
const OUTCOME_WINDOW = 50

/** Minimum recent requests before the API error rate can mark health degraded. */
const API_ERROR_MIN_SAMPLES = 10

/** Recent error rate (0..1) above which health is considered degraded. */
const API_ERROR_RATE_THRESHOLD = 0.5

/** Seconds the WebSocket may stay disconnected before health is degraded. */
const WS_DOWN_THRESHOLD_SEC = 60

/** Subset of `client.getStatus()` the collector relies on. */
export interface ClientStatusLike {
  circuitBreaker: { state: string }
  rateLimiter: { remaining: number }
  cache: { size: number; hits: number; misses: number }
}

/** Subset of `ws.getStatus()` the collector relies on. */
export interface WebSocketStatusLike {
  isConnected: boolean
  isConnecting: boolean
  isClosed: boolean
  lastEventAgeSec: number | null
  subscribed: number
}

/** Absolute device gauges, computed by the platform from its accessories. */
export interface DeviceGauges {
  cloud: number
  total: number
  on: number
  byType: Record<string, number>
  stateless: number
  excluded: number
}

/**
 * Accessors the collector calls to read live in-memory state. All are synchronous
 * and must never block on the network.
 */
export interface DiagnosticsReaders {
  clientStatus: () => ClientStatusLike
  wsStatus: () => WebSocketStatusLike | null
  devices: () => DeviceGauges
  tokenExpiresInSec: () => number | null
  tokenLastRefreshAt: () => number | null
  tokenRefreshFailureActive: () => boolean
  pollingCadenceSec: () => number
}

interface CollectorOptions {
  pluginVersion: string
  config: LevitonConfig
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number
}

interface CounterSnapshot {
  apiRequests: number
  apiErrors: number
  pollOk: number
  pollFailed: number
  wsReconnects: number
  breakerTrips: number
  throttles: number
  tokenRefreshes: number
  commandsSent: number
  externalChanges: number
  retries: number
  cacheHits: number
  cacheMisses: number
}

/**
 * Health classification result.
 */
export interface HealthRollup {
  health: 'healthy' | 'degraded'
  reasons: string[]
}

/**
 * Accumulates diagnostics counters and renders heartbeat/snapshot reports.
 */
export class DiagnosticsCollector {
  private readonly now: () => number
  private readonly startedAtMs: number
  private readonly pluginVersion: string
  private readonly configEcho: Record<string, unknown>

  // Cumulative counters
  private apiRequests = 0
  private apiErrors = 0
  private pollOk = 0
  private pollFailed = 0
  private wsReconnects = 0
  private breakerTrips = 0
  private throttles = 0
  private tokenRefreshes = 0
  private commandsSent = 0
  private externalChanges = 0
  private retries = 0

  // Internal gauges advanced by increment methods
  private lastTripAt: number | null = null
  private lastPollDurationMs: number | null = null

  // Bounded windows
  private readonly latencies: number[] = []
  private readonly recentOutcomes: boolean[] = []

  // Marker captured at the previous heartbeat, used to derive deltas
  private marker: CounterSnapshot

  constructor(options: CollectorOptions) {
    this.now = options.now ?? Date.now
    this.startedAtMs = this.now()
    this.pluginVersion = options.pluginVersion
    this.configEcho = redactConfig(options.config)
    this.marker = this.captureCounters(0, 0)
  }

  /**
   * Record a single API request outcome and its wall-clock duration. Fires for
   * every request, including timeouts and errors (ok === false). Latency is only
   * sampled when a network fetch was actually attempted (`networked`), so
   * instant pre-flight rejections (breaker open, rate limited) don't skew
   * percentiles.
   */
  apiRequest(latencyMs: number, ok: boolean, networked = true): void {
    this.apiRequests++
    if (!ok) {
      this.apiErrors++
    }

    if (networked && Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.latencies.push(latencyMs)
      if (this.latencies.length > LATENCY_WINDOW) {
        this.latencies.shift()
      }
    }

    this.recentOutcomes.push(ok)
    if (this.recentOutcomes.length > OUTCOME_WINDOW) {
      this.recentOutcomes.shift()
    }
  }

  /**
   * Record the result of a polling cycle: how many device fetches succeeded,
   * how many failed, and the total cycle duration.
   */
  pollCycle(ok: number, failed: number, durationMs: number): void {
    this.pollOk += ok
    this.pollFailed += failed
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.lastPollDurationMs = durationMs
    }
  }

  /** Record a WebSocket reconnection (live channel recovered). */
  wsReconnect(): void {
    this.wsReconnects++
  }

  /** Record a circuit-breaker trip (transition into the open state). */
  breakerTrip(): void {
    this.breakerTrips++
    this.lastTripAt = this.now()
  }

  /** Record a write rejected by the client-side rate limiter. */
  throttle(): void {
    this.throttles++
  }

  /** Record a successful token refresh. */
  tokenRefresh(): void {
    this.tokenRefreshes++
  }

  /** Record a HomeKit-originated command (power/brightness write). */
  command(): void {
    this.commandsSent++
  }

  /** Record a device state change that did not originate from HomeKit. */
  externalChange(): void {
    this.externalChanges++
  }

  /** Record a retry attempt (e.g. token-refresh-and-retry). */
  retry(): void {
    this.retries++
  }

  /**
   * Nearest-rank percentile (0..100) over the bounded recent-latency window.
   * Returns 0 when no samples are available.
   */
  percentile(p: number): number {
    if (this.latencies.length === 0) {
      return 0
    }
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const clamped = Math.min(100, Math.max(0, p))
    const rank = Math.ceil((clamped / 100) * sorted.length)
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
    return sorted[index]
  }

  /**
   * Classify current health from live readers. Health is degraded if any of:
   * circuit breaker open; WebSocket disconnected for longer than the threshold;
   * recent API error rate over threshold with a minimum sample size; or token
   * refresh currently in its failure cooldown.
   */
  rollup(readers: DiagnosticsReaders): HealthRollup {
    const reasons: string[] = []

    if (readers.clientStatus().circuitBreaker.state === 'OPEN') {
      reasons.push('circuitBreakerOpen')
    }

    const ws = readers.wsStatus()
    const wsAgeSec = ws?.lastEventAgeSec ?? this.uptimeSec()
    if ((!ws || !ws.isConnected) && wsAgeSec > WS_DOWN_THRESHOLD_SEC) {
      reasons.push('webSocketDown')
    }

    const total = this.recentOutcomes.length
    if (total >= API_ERROR_MIN_SAMPLES) {
      const errors = this.recentOutcomes.filter(ok => !ok).length
      if (errors / total > API_ERROR_RATE_THRESHOLD) {
        reasons.push('apiErrorRateHigh')
      }
    }

    if (readers.tokenRefreshFailureActive()) {
      reasons.push('tokenRefreshFailing')
    }

    return {
      health: reasons.length > 0 ? 'degraded' : 'healthy',
      reasons,
    }
  }

  /**
   * Build a heartbeat report: counters are deltas since the previous heartbeat
   * (the marker is then advanced) and everything else is an absolute gauge.
   */
  buildHeartbeat(readers: DiagnosticsReaders): DiagnosticsSnapshot {
    const status = readers.clientStatus()
    const current = this.captureCounters(status.cache.hits, status.cache.misses)

    const deltaHits = current.cacheHits - this.marker.cacheHits
    const deltaMisses = current.cacheMisses - this.marker.cacheMisses
    const hitRate = ratio(deltaHits, deltaHits + deltaMisses)

    const counters: CounterValues = {
      reconnects: current.wsReconnects - this.marker.wsReconnects,
      trips: current.breakerTrips - this.marker.breakerTrips,
      throttled: current.throttles - this.marker.throttles,
      refreshes: current.tokenRefreshes - this.marker.tokenRefreshes,
      pollOk: current.pollOk - this.marker.pollOk,
      pollFailed: current.pollFailed - this.marker.pollFailed,
      requests: current.apiRequests - this.marker.apiRequests,
      errors: current.apiErrors - this.marker.apiErrors,
      commandsSent: current.commandsSent - this.marker.commandsSent,
      externalChanges: current.externalChanges - this.marker.externalChanges,
      retries: current.retries - this.marker.retries,
    }

    const report = this.buildReport('health', counters, hitRate, readers)
    this.marker = current
    return report
  }

  /**
   * Build a session-cumulative snapshot (no marker advance), including the
   * redacted config echo. Used for boot/shutdown reports.
   */
  snapshot(msg: string, readers: DiagnosticsReaders): DiagnosticsSnapshot {
    const status = readers.clientStatus()
    const hitRate = ratio(status.cache.hits, status.cache.hits + status.cache.misses)

    const counters: CounterValues = {
      reconnects: this.wsReconnects,
      trips: this.breakerTrips,
      throttled: this.throttles,
      refreshes: this.tokenRefreshes,
      pollOk: this.pollOk,
      pollFailed: this.pollFailed,
      requests: this.apiRequests,
      errors: this.apiErrors,
      commandsSent: this.commandsSent,
      externalChanges: this.externalChanges,
      retries: this.retries,
    }

    const report = this.buildReport(msg, counters, hitRate, readers)
    report.config = { ...this.configEcho }
    return report
  }

  /** Seconds since the collector was created. */
  private uptimeSec(): number {
    return Math.round((this.now() - this.startedAtMs) / 1000)
  }

  private captureCounters(cacheHits: number, cacheMisses: number): CounterSnapshot {
    return {
      apiRequests: this.apiRequests,
      apiErrors: this.apiErrors,
      pollOk: this.pollOk,
      pollFailed: this.pollFailed,
      wsReconnects: this.wsReconnects,
      breakerTrips: this.breakerTrips,
      throttles: this.throttles,
      tokenRefreshes: this.tokenRefreshes,
      commandsSent: this.commandsSent,
      externalChanges: this.externalChanges,
      retries: this.retries,
      cacheHits,
      cacheMisses,
    }
  }

  private buildReport(
    msg: string,
    counters: CounterValues,
    hitRate: number,
    readers: DiagnosticsReaders,
  ): DiagnosticsSnapshot {
    const status = readers.clientStatus()
    const ws = readers.wsStatus()
    const { health, reasons } = this.rollup(readers)

    return {
      msg,
      lifecycle: {
        health,
        reasons,
        uptimeSec: this.uptimeSec(),
        pluginVersion: this.pluginVersion,
      },
      devices: readers.devices(),
      websocket: {
        state: webSocketState(ws),
        lastEventAgeSec: ws ? ws.lastEventAgeSec : null,
        subscribed: ws ? ws.subscribed : 0,
        reconnects: counters.reconnects,
      },
      circuitBreaker: {
        state: status.circuitBreaker.state,
        lastTripAt: this.lastTripAt,
        trips: counters.trips,
      },
      rateLimiter: {
        available: status.rateLimiter.remaining,
        throttled: counters.throttled,
      },
      cache: {
        size: status.cache.size,
        hitRate,
      },
      polling: {
        cadenceSec: readers.pollingCadenceSec(),
        lastDurationMs: this.lastPollDurationMs,
        ok: counters.pollOk,
        failed: counters.pollFailed,
      },
      token: {
        expiresInSec: readers.tokenExpiresInSec(),
        lastRefreshAt: readers.tokenLastRefreshAt(),
        refreshes: counters.refreshes,
      },
      api: {
        p50Ms: this.percentile(50),
        p95Ms: this.percentile(95),
        requests: counters.requests,
        errors: counters.errors,
      },
      activity: {
        commandsSent: counters.commandsSent,
        externalChanges: counters.externalChanges,
        retries: counters.retries,
      },
    }
  }
}

interface CounterValues {
  reconnects: number
  trips: number
  throttled: number
  refreshes: number
  pollOk: number
  pollFailed: number
  requests: number
  errors: number
  commandsSent: number
  externalChanges: number
  retries: number
}

/** Safe ratio that never divides by zero. */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

/** Map a WebSocket status into a single descriptive state string. */
function webSocketState(ws: WebSocketStatusLike | null): string {
  if (!ws) {
    return 'disconnected'
  }
  if (ws.isClosed) {
    return 'closed'
  }
  if (ws.isConnected) {
    return 'connected'
  }
  if (ws.isConnecting) {
    return 'connecting'
  }
  return 'disconnected'
}

/**
 * Build a redacted echo of the plugin config for snapshots. Credentials
 * (email/password) and any token are never included; array options are reduced
 * to counts to keep the echo compact and free of device-identifying data.
 */
function redactConfig(config: LevitonConfig): Record<string, unknown> {
  return {
    diagnosticsInterval: config.diagnosticsInterval ?? 0,
    pollInterval: config.pollInterval ?? config.pollingInterval,
    connectionTimeout: config.connectionTimeout,
    loglevel: config.loglevel,
    structuredLogs: config.structuredLogs ?? false,
    connectivitySensor: config.connectivitySensor ?? false,
    excludedModels: Array.isArray(config.excludedModels) ? config.excludedModels.length : 0,
    excludedSerials: Array.isArray(config.excludedSerials) ? config.excludedSerials.length : 0,
  }
}
