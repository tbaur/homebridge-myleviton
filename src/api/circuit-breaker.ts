/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Circuit breaker pattern for API resilience
 */

import { CircuitBreakerError } from '../errors'

/**
 * Circuit breaker states
 */
export enum CircuitState {
  /** Normal operation - requests flow through */
  CLOSED = 'CLOSED',
  /** Circuit tripped - requests fail immediately */
  OPEN = 'OPEN',
  /** Testing if service recovered */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number
  /** Time in ms before trying half-open */
  resetTimeout: number
  /** Max requests allowed in half-open state */
  halfOpenMax: number
  /** Window for counting failures (ms) */
  failureWindow?: number
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenMax: 3,
  failureWindow: 60000,
}

/**
 * Circuit breaker status
 */
export interface CircuitBreakerStatus {
  state: CircuitState
  failures: number
  successes: number
  lastFailureTime: number | null
  halfOpenRequests: number
  isOpen: boolean
  remainingResetTime: number | null
}

/**
 * Circuit breaker implementation for API resilience
 * Prevents cascading failures when the Leviton API is down
 */
export class CircuitBreaker {
  private readonly failureThreshold: number
  private readonly resetTimeout: number
  private readonly halfOpenMax: number
  private readonly failureWindow: number

  private _state: CircuitState = CircuitState.CLOSED
  private failures = 0
  private successes = 0
  private lastFailureTime: number | null = null
  private halfOpenRequests = 0
  private failureTimestamps: number[] = []

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    const merged = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config }
    this.failureThreshold = merged.failureThreshold
    this.resetTimeout = merged.resetTimeout
    this.halfOpenMax = merged.halfOpenMax
    this.failureWindow = merged.failureWindow ?? 60000
  }

  /**
   * Current circuit state
   */
  get state(): CircuitState {
    return this._state
  }

  /**
   * Check if circuit is open
   */
  get isOpen(): boolean {
    return this._state === CircuitState.OPEN
  }

  /**
   * Clean up old failure timestamps
   */
  private cleanupFailures(): void {
    const cutoff = Date.now() - this.failureWindow
    this.failureTimestamps = this.failureTimestamps.filter(ts => ts > cutoff)
    this.failures = this.failureTimestamps.length
  }

  /**
   * Check if circuit allows requests
   */
  canRequest(): boolean {
    if (this._state === CircuitState.CLOSED) {
      return true
    }

    if (this._state === CircuitState.OPEN) {
      // Check if enough time has passed to try again
      if (this.lastFailureTime && (Date.now() - this.lastFailureTime) >= this.resetTimeout) {
        this._state = CircuitState.HALF_OPEN
        this.halfOpenRequests = 0
        this.successes = 0
        return true
      }
      return false
    }

    if (this._state === CircuitState.HALF_OPEN) {
      // Allow limited requests in half-open state
      return this.halfOpenRequests < this.halfOpenMax
    }

    return false
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    if (this._state === CircuitState.HALF_OPEN) {
      this.successes++
      // After enough successes in half-open, close the circuit
      if (this.successes >= this.halfOpenMax) {
        this.reset()
      }
    } else if (this._state === CircuitState.CLOSED) {
      // Gradually reduce failure count on success
      this.cleanupFailures()
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    const now = Date.now()
    this.lastFailureTime = now
    this.failureTimestamps.push(now)

    if (this._state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state opens the circuit again
      this._state = CircuitState.OPEN
      this.halfOpenRequests = 0
      this.successes = 0
    } else if (this._state === CircuitState.CLOSED) {
      this.cleanupFailures()
      if (this.failures >= this.failureThreshold) {
        this._state = CircuitState.OPEN
      }
    }
  }

  /**
   * Track half-open request
   */
  trackHalfOpenRequest(): void {
    if (this._state === CircuitState.HALF_OPEN) {
      this.halfOpenRequests++
    }
  }

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this._state = CircuitState.CLOSED
    this.failures = 0
    this.successes = 0
    this.lastFailureTime = null
    this.halfOpenRequests = 0
    this.failureTimestamps = []
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): CircuitBreakerStatus {
    const now = Date.now()
    let remainingResetTime: number | null = null

    if (this._state === CircuitState.OPEN && this.lastFailureTime) {
      remainingResetTime = Math.max(0, this.resetTimeout - (now - this.lastFailureTime))
    }

    return {
      state: this._state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      halfOpenRequests: this.halfOpenRequests,
      isOpen: this.isOpen,
      remainingResetTime,
    }
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canRequest()) {
      const status = this.getStatus()
      throw new CircuitBreakerError(status.remainingResetTime ?? this.resetTimeout)
    }

    if (this._state === CircuitState.HALF_OPEN) {
      this.trackHalfOpenRequest()
    }

    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (error) {
      this.recordFailure()
      throw error
    }
  }

  /**
   * Create a wrapped version of a function with circuit breaker protection
   */
  wrap<T extends unknown[], R>(fn: (...args: T) => Promise<R>): (...args: T) => Promise<R> {
    return (...args: T) => this.execute(() => fn(...args))
  }
}

/**
 * Global circuit breaker instance
 */
let globalCircuitBreaker: CircuitBreaker | null = null

/**
 * Get or create the global circuit breaker
 */
export function getCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = new CircuitBreaker(config)
  }
  return globalCircuitBreaker
}

/**
 * Reset the global circuit breaker (for testing)
 */
export function resetGlobalCircuitBreaker(): void {
  globalCircuitBreaker = null
}

