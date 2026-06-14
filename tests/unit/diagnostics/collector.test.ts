/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { DiagnosticsCollector } from '../../../src/diagnostics/collector'
import type { DiagnosticsReaders } from '../../../src/diagnostics/collector'
import type { LevitonConfig } from '../../../src/types'

const baseConfig = (): LevitonConfig => ({
  platform: 'MyLevitonDecoraSmart',
  name: 'My Leviton',
  email: 'secret@example.com',
  password: 'superSecretPassword',
  diagnosticsInterval: 60,
  pollInterval: 30,
  structuredLogs: true,
  connectivitySensor: true,
  excludedModels: ['DW15P'],
  excludedSerials: ['AAA', 'BBB'],
})

interface MutableReaders {
  readers: DiagnosticsReaders
  cache: { size: number; hits: number; misses: number }
  breakerState: { value: string }
  ws: {
    value: {
      isConnected: boolean
      isConnecting: boolean
      isClosed: boolean
      lastEventAgeSec: number | null
      subscribed: number
    } | null
  }
  rateLimiterRemaining: { value: number }
  tokenExpiresInSec: { value: number | null }
  tokenLastRefreshAt: { value: number | null }
  tokenRefreshFailureActive: { value: boolean }
}

const makeReaders = (): MutableReaders => {
  const cache = { size: 5, hits: 0, misses: 0 }
  const breakerState = { value: 'CLOSED' }
  const ws = {
    value: {
      isConnected: true,
      isConnecting: false,
      isClosed: false,
      lastEventAgeSec: 2 as number | null,
      subscribed: 3,
    } as MutableReaders['ws']['value'],
  }
  const rateLimiterRemaining = { value: 250 }
  const tokenExpiresInSec = { value: 1000 as number | null }
  const tokenLastRefreshAt = { value: null as number | null }
  const tokenRefreshFailureActive = { value: false }

  const readers: DiagnosticsReaders = {
    clientStatus: () => ({
      circuitBreaker: { state: breakerState.value },
      rateLimiter: { remaining: rateLimiterRemaining.value },
      cache: { size: cache.size, hits: cache.hits, misses: cache.misses },
    }),
    wsStatus: () => ws.value,
    devices: () => ({ total: 4, on: 2, byType: { dimmer: 3, switch: 1 }, excluded: 1 }),
    tokenExpiresInSec: () => tokenExpiresInSec.value,
    tokenLastRefreshAt: () => tokenLastRefreshAt.value,
    tokenRefreshFailureActive: () => tokenRefreshFailureActive.value,
    pollingCadenceSec: () => 30,
  }

  return {
    readers,
    cache,
    breakerState,
    ws,
    rateLimiterRemaining,
    tokenExpiresInSec,
    tokenLastRefreshAt,
    tokenRefreshFailureActive,
  }
}

describe('DiagnosticsCollector', () => {
  describe('counter deltas and marker advance', () => {
    it('reports per-interval deltas and advances the marker each heartbeat', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '9.9.9', config: baseConfig() })

      collector.apiRequest(100, true)
      collector.apiRequest(200, false)
      collector.pollCycle(3, 1, 42)
      collector.command()
      collector.command()
      collector.externalChange()
      collector.retry()
      collector.tokenRefresh()
      collector.wsReconnect()
      collector.breakerTrip()
      collector.throttle()

      const first = collector.buildHeartbeat(m.readers)
      expect(first.api.requests).toBe(2)
      expect(first.api.errors).toBe(1)
      expect(first.polling.ok).toBe(3)
      expect(first.polling.failed).toBe(1)
      expect(first.polling.lastDurationMs).toBe(42)
      expect(first.activity.commandsSent).toBe(2)
      expect(first.activity.externalChanges).toBe(1)
      expect(first.activity.retries).toBe(1)
      expect(first.token.refreshes).toBe(1)
      expect(first.websocket.reconnects).toBe(1)
      expect(first.circuitBreaker.trips).toBe(1)
      expect(first.rateLimiter.throttled).toBe(1)

      // Second heartbeat with no new activity → all counter deltas are zero.
      const second = collector.buildHeartbeat(m.readers)
      expect(second.api.requests).toBe(0)
      expect(second.api.errors).toBe(0)
      expect(second.activity.commandsSent).toBe(0)
      expect(second.circuitBreaker.trips).toBe(0)

      // New activity after the marker is reflected in the next delta only.
      collector.command()
      const third = collector.buildHeartbeat(m.readers)
      expect(third.activity.commandsSent).toBe(1)
    })
  })

  describe('percentile', () => {
    it('returns 0 with no samples', () => {
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      expect(collector.percentile(50)).toBe(0)
      expect(collector.percentile(95)).toBe(0)
    })

    it('computes nearest-rank percentiles', () => {
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      for (const latency of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
        collector.apiRequest(latency, true)
      }
      expect(collector.percentile(0)).toBe(10)
      expect(collector.percentile(50)).toBe(50)
      expect(collector.percentile(95)).toBe(100)
      expect(collector.percentile(100)).toBe(100)
    })

    it('bounds the latency window to the most recent samples', () => {
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      // Push 250 samples; only the last 200 are retained. First 50 (value 1) drop off.
      for (let i = 0; i < 250; i++) {
        collector.apiRequest(i < 50 ? 1 : 500, true)
      }
      expect(collector.percentile(0)).toBe(500)
    })

    it('excludes non-networked rejections from the latency window', () => {
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      collector.apiRequest(100, true, true)
      collector.apiRequest(200, true, true)
      // Instant pre-flight rejection (~0ms): counted as a request/error but must
      // not drag the latency percentiles toward zero.
      collector.apiRequest(0, false, false)
      expect(collector.percentile(0)).toBe(100)
      expect(collector.percentile(100)).toBe(200)
    })
  })

  describe('cache hit rate over the interval', () => {
    it('computes hit rate from interval deltas, not cumulative totals', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })

      m.cache.hits = 8
      m.cache.misses = 2
      const first = collector.buildHeartbeat(m.readers)
      expect(first.cache.hitRate).toBeCloseTo(0.8)
      expect(first.cache.size).toBe(5)

      // Only 2 new hits, 0 new misses since the last heartbeat → interval rate 1.0.
      m.cache.hits = 10
      m.cache.misses = 2
      const second = collector.buildHeartbeat(m.readers)
      expect(second.cache.hitRate).toBeCloseTo(1.0)
    })

    it('reports a 0 hit rate when there is no cache activity', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const report = collector.buildHeartbeat(m.readers)
      expect(report.cache.hitRate).toBe(0)
    })
  })

  describe('gauges', () => {
    it('reflects live reader gauges and internal gauge state', () => {
      const m = makeReaders()
      let clock = 1_000_000
      const collector = new DiagnosticsCollector({
        pluginVersion: '3.7.0',
        config: baseConfig(),
        now: () => clock,
      })

      collector.breakerTrip()
      collector.pollCycle(1, 0, 77)
      clock += 5000

      const report = collector.buildHeartbeat(m.readers)
      expect(report.lifecycle.pluginVersion).toBe('3.7.0')
      expect(report.lifecycle.uptimeSec).toBe(5)
      expect(report.devices).toEqual({ total: 4, on: 2, byType: { dimmer: 3, switch: 1 }, excluded: 1 })
      expect(report.websocket.state).toBe('connected')
      expect(report.websocket.subscribed).toBe(3)
      expect(report.websocket.lastEventAgeSec).toBe(2)
      expect(report.circuitBreaker.state).toBe('CLOSED')
      expect(report.circuitBreaker.lastTripAt).toBe(1_000_000)
      expect(report.rateLimiter.available).toBe(250)
      expect(report.polling.cadenceSec).toBe(30)
      expect(report.polling.lastDurationMs).toBe(77)
      expect(report.token.expiresInSec).toBe(1000)
    })

    it('maps websocket states and a missing socket', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })

      m.ws.value = { isConnected: false, isConnecting: true, isClosed: false, lastEventAgeSec: null, subscribed: 0 }
      expect(collector.buildHeartbeat(m.readers).websocket.state).toBe('connecting')

      m.ws.value = { isConnected: false, isConnecting: false, isClosed: true, lastEventAgeSec: 5, subscribed: 0 }
      expect(collector.buildHeartbeat(m.readers).websocket.state).toBe('closed')

      m.ws.value = null
      const report = collector.buildHeartbeat(m.readers)
      expect(report.websocket.state).toBe('disconnected')
      expect(report.websocket.lastEventAgeSec).toBeNull()
      expect(report.websocket.subscribed).toBe(0)
    })
  })

  describe('rollup', () => {
    it('is healthy by default', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const result = collector.rollup(m.readers)
      expect(result.health).toBe('healthy')
      expect(result.reasons).toEqual([])
    })

    it('is degraded when the circuit breaker is open', () => {
      const m = makeReaders()
      m.breakerState.value = 'OPEN'
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const result = collector.rollup(m.readers)
      expect(result.health).toBe('degraded')
      expect(result.reasons).toContain('circuitBreakerOpen')
    })

    it('is degraded when the websocket has been down beyond the threshold', () => {
      const m = makeReaders()
      m.ws.value = { isConnected: false, isConnecting: false, isClosed: false, lastEventAgeSec: 120, subscribed: 0 }
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      expect(collector.rollup(m.readers).reasons).toContain('webSocketDown')
    })

    it('is not degraded when the websocket dropped only briefly', () => {
      const m = makeReaders()
      m.ws.value = { isConnected: false, isConnecting: true, isClosed: false, lastEventAgeSec: 5, subscribed: 0 }
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      expect(collector.rollup(m.readers).reasons).not.toContain('webSocketDown')
    })

    it('uses uptime as the age baseline when the socket never connected', () => {
      const m = makeReaders()
      m.ws.value = null
      let clock = 0
      const collector = new DiagnosticsCollector({
        pluginVersion: '1.0.0',
        config: baseConfig(),
        now: () => clock,
      })
      expect(collector.rollup(m.readers).reasons).not.toContain('webSocketDown')
      clock = 65_000
      expect(collector.rollup(m.readers).reasons).toContain('webSocketDown')
    })

    it('is degraded when the recent API error rate is high with enough samples', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      // 6 errors out of 10 → 60% > 50% threshold.
      for (let i = 0; i < 6; i++) {
        collector.apiRequest(50, false)
      }
      for (let i = 0; i < 4; i++) {
        collector.apiRequest(50, true)
      }
      expect(collector.rollup(m.readers).reasons).toContain('apiErrorRateHigh')
    })

    it('ignores a high error rate below the minimum sample size', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      collector.apiRequest(50, false)
      collector.apiRequest(50, false)
      expect(collector.rollup(m.readers).reasons).not.toContain('apiErrorRateHigh')
    })

    it('is degraded during a token refresh failure cooldown', () => {
      const m = makeReaders()
      m.tokenRefreshFailureActive.value = true
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      expect(collector.rollup(m.readers).reasons).toContain('tokenRefreshFailing')
    })

    it('reports multiple simultaneous reasons', () => {
      const m = makeReaders()
      m.breakerState.value = 'OPEN'
      m.tokenRefreshFailureActive.value = true
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const result = collector.rollup(m.readers)
      expect(result.health).toBe('degraded')
      expect(result.reasons).toEqual(expect.arrayContaining(['circuitBreakerOpen', 'tokenRefreshFailing']))
    })

    it('flows the rollup health into heartbeat lifecycle', () => {
      const m = makeReaders()
      m.breakerState.value = 'OPEN'
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const report = collector.buildHeartbeat(m.readers)
      expect(report.lifecycle.health).toBe('degraded')
      expect(report.lifecycle.reasons).toContain('circuitBreakerOpen')
    })
  })

  describe('snapshot', () => {
    it('reports session-cumulative totals without advancing the marker', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })

      collector.command()
      collector.command()
      collector.apiRequest(10, true)

      const snap1 = collector.snapshot('diagnostics.start', m.readers)
      expect(snap1.msg).toBe('diagnostics.start')
      expect(snap1.activity.commandsSent).toBe(2)
      expect(snap1.api.requests).toBe(1)

      // Snapshots do not reset the marker — a heartbeat still sees the deltas.
      const beat = collector.buildHeartbeat(m.readers)
      expect(beat.activity.commandsSent).toBe(2)

      // A second snapshot remains cumulative.
      collector.command()
      const snap2 = collector.snapshot('diagnostics.stop', m.readers)
      expect(snap2.activity.commandsSent).toBe(3)
    })

    it('includes a redacted config echo and never leaks credentials', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      const snap = collector.snapshot('diagnostics.start', m.readers)

      expect(snap.config).toBeDefined()
      expect(snap.config).toMatchObject({
        diagnosticsInterval: 60,
        pollInterval: 30,
        structuredLogs: true,
        connectivitySensor: true,
        excludedModels: 1,
        excludedSerials: 2,
      })
      expect(snap.config).not.toHaveProperty('email')
      expect(snap.config).not.toHaveProperty('password')

      const serialized = JSON.stringify(snap)
      expect(serialized).not.toContain('secret@example.com')
      expect(serialized).not.toContain('superSecretPassword')
    })

    it('does not attach a config echo to heartbeats', () => {
      const m = makeReaders()
      const collector = new DiagnosticsCollector({ pluginVersion: '1.0.0', config: baseConfig() })
      expect(collector.buildHeartbeat(m.readers).config).toBeUndefined()
    })
  })
})
