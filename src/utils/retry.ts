/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Centralized retry logic with configurable policies
 */

import { isRetryableError, getErrorCode, RateLimitError } from '../errors'
import type { RetryPolicy } from '../types'

/**
 * Default retry policy
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['AUTH_ERROR', 'TOKEN_EXPIRED', 'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED'],
}

/**
 * Aggressive retry policy for critical operations
 */
export const AGGRESSIVE_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelay: 500,
  maxDelay: 60000,
  backoffMultiplier: 2,
  retryableErrors: ['AUTH_ERROR', 'TOKEN_EXPIRED', 'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'API_ERROR'],
}

/**
 * Conservative retry policy for non-critical operations
 */
export const CONSERVATIVE_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  baseDelay: 2000,
  maxDelay: 10000,
  backoffMultiplier: 1.5,
  retryableErrors: ['NETWORK_ERROR', 'TIMEOUT'],
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  multiplier: number,
): number {
  // Exponential backoff
  const exponentialDelay = baseDelay * Math.pow(multiplier, attempt - 1)
  
  // Add jitter (±25%)
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1)
  
  // Cap at max delay
  return Math.min(exponentialDelay + jitter, maxDelay)
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: Partial<RetryPolicy> = {},
): Promise<T> {
  const {
    maxAttempts,
    baseDelay,
    maxDelay,
    backoffMultiplier,
    retryableErrors,
    onRetry,
  } = { ...DEFAULT_RETRY_POLICY, ...policy }

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      const errorCode = getErrorCode(error)
      
      // Check if error is retryable
      const isRetryable = isRetryableError(error) || retryableErrors.includes(errorCode)
      
      if (!isRetryable || attempt === maxAttempts) {
        throw error
      }

      // Calculate delay
      let delay: number
      if (error instanceof RateLimitError) {
        // Use retry-after from rate limit error if available
        delay = error.retryAfter * 1000
      } else {
        delay = calculateBackoffDelay(attempt, baseDelay, maxDelay, backoffMultiplier)
      }

      // Call retry callback if provided
      onRetry?.(attempt, error as Error)

      // Wait before retrying
      await sleep(delay)
    }
  }

  throw lastError!
}

/**
 * Create a retryable version of a function
 */
export function makeRetryable<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  policy: Partial<RetryPolicy> = {},
): (...args: T) => Promise<R> {
  return (...args: T) => withRetry(() => fn(...args), policy)
}

/**
 * Retry with timeout
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  policy: Partial<RetryPolicy> = {},
): Promise<T> {
  return withRetry(async () => {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  }, policy)
}

/**
 * Context for retry operations (for logging)
 */
export interface RetryContext {
  operation: string
  attempt: number
  maxAttempts: number
  error?: Error
  delay?: number
}

/**
 * Execute with retry and context logging
 */
export async function withRetryContext<T>(
  operation: string,
  fn: () => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  logger?: (context: RetryContext) => void,
): Promise<T> {
  const mergedPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy }
  
  const policyWithLogging: RetryPolicy = {
    ...mergedPolicy,
    onRetry: (attempt, error) => {
      const delay = calculateBackoffDelay(
        attempt,
        mergedPolicy.baseDelay,
        mergedPolicy.maxDelay,
        mergedPolicy.backoffMultiplier,
      )
      
      logger?.({
        operation,
        attempt,
        maxAttempts: mergedPolicy.maxAttempts,
        error,
        delay,
      })
      
      mergedPolicy.onRetry?.(attempt, error)
    },
  }

  return withRetry(fn, policyWithLogging)
}

