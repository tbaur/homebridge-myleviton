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
import type { DiagnosticsSnapshot, LevitonConfig } from '../types';
/** Subset of `client.getStatus()` the collector relies on. */
export interface ClientStatusLike {
    circuitBreaker: {
        state: string;
    };
    rateLimiter: {
        remaining: number;
    };
    cache: {
        size: number;
        hits: number;
        misses: number;
    };
}
/** Subset of `ws.getStatus()` the collector relies on. */
export interface WebSocketStatusLike {
    isConnected: boolean;
    isConnecting: boolean;
    isClosed: boolean;
    lastEventAgeSec: number | null;
    subscribed: number;
}
/** Absolute device gauges, computed by the platform from its accessories. */
export interface DeviceGauges {
    cloud: number;
    total: number;
    on: number;
    byType: Record<string, number>;
    stateless: number;
    excluded: number;
}
/**
 * Accessors the collector calls to read live in-memory state. All are synchronous
 * and must never block on the network.
 */
export interface DiagnosticsReaders {
    clientStatus: () => ClientStatusLike;
    wsStatus: () => WebSocketStatusLike | null;
    devices: () => DeviceGauges;
    tokenExpiresInSec: () => number | null;
    tokenLastRefreshAt: () => number | null;
    tokenRefreshFailureActive: () => boolean;
    pollingCadenceSec: () => number;
}
interface CollectorOptions {
    pluginVersion: string;
    config: LevitonConfig;
    /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
}
/**
 * Health classification result.
 */
export interface HealthRollup {
    health: 'healthy' | 'degraded';
    reasons: string[];
}
/**
 * Accumulates diagnostics counters and renders heartbeat/snapshot reports.
 */
export declare class DiagnosticsCollector {
    private readonly now;
    private readonly startedAtMs;
    private readonly pluginVersion;
    private readonly configEcho;
    private apiRequests;
    private apiErrors;
    private pollOk;
    private pollFailed;
    private wsReconnects;
    private breakerTrips;
    private throttles;
    private tokenRefreshes;
    private commandsSent;
    private externalChanges;
    private retries;
    private lastTripAt;
    private lastPollDurationMs;
    private readonly latencies;
    private readonly recentOutcomes;
    private marker;
    constructor(options: CollectorOptions);
    /**
     * Record a single API request outcome and its wall-clock duration. Fires for
     * every request, including timeouts and errors (ok === false). Latency is only
     * sampled when a network fetch was actually attempted (`networked`), so
     * instant pre-flight rejections (breaker open, rate limited) don't skew
     * percentiles.
     */
    apiRequest(latencyMs: number, ok: boolean, networked?: boolean): void;
    /**
     * Record the result of a polling cycle: how many device fetches succeeded,
     * how many failed, and the total cycle duration.
     */
    pollCycle(ok: number, failed: number, durationMs: number): void;
    /** Record a WebSocket reconnection (live channel recovered). */
    wsReconnect(): void;
    /** Record a circuit-breaker trip (transition into the open state). */
    breakerTrip(): void;
    /** Record a write rejected by the client-side rate limiter. */
    throttle(): void;
    /** Record a successful token refresh. */
    tokenRefresh(): void;
    /** Record a HomeKit-originated command (power/brightness write). */
    command(): void;
    /** Record a device state change that did not originate from HomeKit. */
    externalChange(): void;
    /** Record a retry attempt (e.g. token-refresh-and-retry). */
    retry(): void;
    /**
     * Nearest-rank percentile (0..100) over the bounded recent-latency window.
     * Returns 0 when no samples are available.
     */
    percentile(p: number): number;
    /**
     * Classify current health from live readers. Health is degraded if any of:
     * circuit breaker open; WebSocket disconnected for longer than the threshold;
     * recent API error rate over threshold with a minimum sample size; or token
     * refresh currently in its failure cooldown.
     */
    rollup(readers: DiagnosticsReaders): HealthRollup;
    /**
     * Build a heartbeat report: counters are deltas since the previous heartbeat
     * (the marker is then advanced) and everything else is an absolute gauge.
     */
    buildHeartbeat(readers: DiagnosticsReaders): DiagnosticsSnapshot;
    /**
     * Build a session-cumulative snapshot (no marker advance), including the
     * redacted config echo. Used for boot/shutdown reports.
     */
    snapshot(msg: string, readers: DiagnosticsReaders): DiagnosticsSnapshot;
    /** Seconds since the collector was created. */
    private uptimeSec;
    private captureCounters;
    private buildReport;
}
export {};
//# sourceMappingURL=collector.d.ts.map