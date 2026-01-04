/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Token bucket rate limiter for API requests
 */

import { RateLimitError } from '../errors'
import { sleep } from '../utils/retry'

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Maximum requests per window */
  maxRequests: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Whether to wait when rate limited (vs throwing immediately) */
  waitOnLimit?: boolean
  /** Maximum wait time when waitOnLimit is true */
  maxWaitMs?: number
}

/**
 * Default rate limiter configuration
 * Leviton allows max 99 devices per residence, 20 residences per account
 * At startup: 99 devices × 2 queries (power + brightness) = 198 requests
 * Rate limiter only applies to WRITE operations
 */
export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  maxRequests: 300,
  windowMs: 60000, // 1 minute
  waitOnLimit: false,
  maxWaitMs: 30000,
}

/**
 * Token bucket rate limiter
 * Prevents overwhelming the Leviton API with too many requests
 */
export class RateLimiter {
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly waitOnLimit: boolean
  private readonly maxWaitMs: number
  private requests: number[] = []

  constructor(config: Partial<RateLimiterConfig> = {}) {
    const merged = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config }
    this.maxRequests = merged.maxRequests
    this.windowMs = merged.windowMs
    this.waitOnLimit = merged.waitOnLimit ?? false
    this.maxWaitMs = merged.maxWaitMs ?? 30000
  }

  /**
   * Clean up expired request timestamps
   */
  private cleanup(): void {
    const now = Date.now()
    this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs)
  }

  /**
   * Get current request count in window
   */
  get currentCount(): number {
    this.cleanup()
    return this.requests.length
  }

  /**
   * Get remaining requests in window
   */
  get remaining(): number {
    return Math.max(0, this.maxRequests - this.currentCount)
  }

  /**
   * Get time until window resets (oldest request expires)
   */
  get resetTime(): number {
    if (this.requests.length === 0) {return 0}
    const oldest = Math.min(...this.requests)
    return Math.max(0, this.windowMs - (Date.now() - oldest))
  }

  /**
   * Check if a request can be made without blocking
   */
  canAcquire(): boolean {
    this.cleanup()
    return this.requests.length < this.maxRequests
  }

  /**
   * Try to acquire a request token
   * @returns true if acquired, false if rate limited
   */
  tryAcquire(): boolean {
    this.cleanup()

    if (this.requests.length >= this.maxRequests) {
      return false
    }

    this.requests.push(Date.now())
    return true
  }

  /**
   * Acquire a request token, throwing if rate limited
   * @throws RateLimitError if rate limited and waitOnLimit is false
   */
  acquire(): void {
    if (!this.tryAcquire()) {
      const retryAfter = Math.ceil(this.resetTime / 1000)
      throw new RateLimitError(
        `Rate limit exceeded. ${this.maxRequests} requests per ${this.windowMs / 1000}s`,
        retryAfter,
      )
    }
  }

  /**
   * Acquire a request token, waiting if necessary
   * @throws RateLimitError if wait exceeds maxWaitMs
   */
  async acquireAsync(): Promise<void> {
    const startTime = Date.now()

    while (!this.tryAcquire()) {
      const elapsed = Date.now() - startTime

      if (elapsed >= this.maxWaitMs) {
        throw new RateLimitError(
          `Rate limit wait exceeded ${this.maxWaitMs}ms`,
          Math.ceil((this.maxWaitMs - elapsed) / 1000),
        )
      }

      // Wait for the oldest request to expire
      const waitTime = Math.min(this.resetTime, this.maxWaitMs - elapsed, 1000)
      if (waitTime > 0) {
        await sleep(waitTime)
      }
    }
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.waitOnLimit) {
      await this.acquireAsync()
    } else {
      this.acquire()
    }
    return fn()
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.requests = []
  }

  /**
   * Get rate limiter status for monitoring
   */
  getStatus(): {
    currentCount: number
    maxRequests: number
    remaining: number
    resetTime: number
    windowMs: number
  } {
    return {
      currentCount: this.currentCount,
      maxRequests: this.maxRequests,
      remaining: this.remaining,
      resetTime: this.resetTime,
      windowMs: this.windowMs,
    }
  }
}

/**
 * Global rate limiter instance
 */
let globalRateLimiter: RateLimiter | null = null

/**
 * Get or create the global rate limiter
 */
export function getRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter(config)
  }
  return globalRateLimiter
}

/**
 * Reset the global rate limiter (for testing)
 */
export function resetGlobalRateLimiter(): void {
  globalRateLimiter = null
}

