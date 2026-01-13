/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  withRetry,
  makeRetryable,
  withRetryAndTimeout,
  withRetryContext,
  sleep,
  calculateBackoffDelay,
  DEFAULT_RETRY_POLICY,
} from '../../src/utils/retry'
import { RateLimitError, AuthenticationError, ConfigurationError } from '../../src/errors'

describe('sleep', () => {
  it('should resolve after specified time', async () => {
    const start = Date.now()
    await sleep(100)
    const elapsed = Date.now() - start
    
    expect(elapsed).toBeGreaterThanOrEqual(95) // Allow small variance
    expect(elapsed).toBeLessThan(200)
  })
})

describe('calculateBackoffDelay', () => {
  it('should calculate exponential backoff', () => {
    const delay1 = calculateBackoffDelay(1, 1000, 30000, 2)
    const delay2 = calculateBackoffDelay(2, 1000, 30000, 2)
    const delay3 = calculateBackoffDelay(3, 1000, 30000, 2)
    
    // Allow for jitter (±25%)
    expect(delay1).toBeGreaterThan(750)
    expect(delay1).toBeLessThan(1250)
    
    expect(delay2).toBeGreaterThan(1500)
    expect(delay2).toBeLessThan(2500)
    
    expect(delay3).toBeGreaterThan(3000)
    expect(delay3).toBeLessThan(5000)
  })

  it('should cap at maxDelay', () => {
    const delay = calculateBackoffDelay(10, 1000, 5000, 2)
    
    expect(delay).toBeLessThanOrEqual(5000)
  })

  it('should add jitter', () => {
    const delays = new Set<number>()
    for (let i = 0; i < 10; i++) {
      delays.add(calculateBackoffDelay(1, 1000, 30000, 2))
    }
    
    // With jitter, we should get some variance
    expect(delays.size).toBeGreaterThan(1)
  })
})

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('success')
    
    const result = await withRetry(fn, { maxAttempts: 3 })
    
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should retry on retryable errors', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new AuthenticationError())
      .mockResolvedValueOnce('success')
    
    const result = await withRetry(fn, { 
      maxAttempts: 3,
      baseDelay: 10, // Fast for testing
    })
    
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('should throw after max attempts', async () => {
    const error = new AuthenticationError()
    const fn = jest.fn().mockRejectedValue(error)
    
    await expect(withRetry(fn, { 
      maxAttempts: 3,
      baseDelay: 10,
    })).rejects.toThrow(AuthenticationError)
    
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('should not retry non-retryable errors', async () => {
    const error = new ConfigurationError('config error')
    const fn = jest.fn().mockRejectedValue(error)
    
    await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow(ConfigurationError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should use retryAfter from RateLimitError', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new RateLimitError('rate limited', 1)) // 1 second
      .mockResolvedValueOnce('success')
    
    const start = Date.now()
    await withRetry(fn, { maxAttempts: 3 })
    const elapsed = Date.now() - start
    
    // Should wait at least 1 second (1000ms) from rate limit
    expect(elapsed).toBeGreaterThanOrEqual(900)
  })

  it('should call onRetry callback', async () => {
    const onRetry = jest.fn()
    const fn = jest.fn()
      .mockRejectedValueOnce(new AuthenticationError())
      .mockResolvedValueOnce('success')
    
    await withRetry(fn, { 
      maxAttempts: 3,
      baseDelay: 10,
      onRetry,
    })
    
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(AuthenticationError))
  })
})

describe('makeRetryable', () => {
  it('should wrap function with retry logic', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new AuthenticationError())
      .mockResolvedValueOnce('success')
    
    const retryableFn = makeRetryable(fn, { baseDelay: 10 })
    const result = await retryableFn()
    
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('should pass arguments to wrapped function', async () => {
    const fn = jest.fn().mockResolvedValue('result')
    const retryableFn = makeRetryable(fn)
    
    await retryableFn('arg1', 'arg2')
    
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
  })
})

describe('withRetryAndTimeout', () => {
  it('should succeed within timeout', async () => {
    const fn = jest.fn().mockResolvedValue('success')
    
    const result = await withRetryAndTimeout(fn, 1000)
    
    expect(result).toBe('success')
  })

  it('should throw on timeout', async () => {
    // Function that never resolves - simulates a hanging operation
    const fn = jest.fn().mockImplementation(() => new Promise(() => {}))
    
    await expect(withRetryAndTimeout(fn, 50)).rejects.toThrow('timed out')
  })
})

describe('withRetryContext', () => {
  it('should log retry context', async () => {
    const logger = jest.fn()
    const fn = jest.fn()
      .mockRejectedValueOnce(new AuthenticationError())
      .mockResolvedValueOnce('success')
    
    await withRetryContext('test-operation', fn, { baseDelay: 10 }, logger)
    
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'test-operation',
      attempt: 1,
      error: expect.any(AuthenticationError),
    }))
  })
})

describe('DEFAULT_RETRY_POLICY', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(3)
    expect(DEFAULT_RETRY_POLICY.baseDelay).toBe(1000)
    expect(DEFAULT_RETRY_POLICY.maxDelay).toBe(30000)
    expect(DEFAULT_RETRY_POLICY.backoffMultiplier).toBe(2)
    expect(DEFAULT_RETRY_POLICY.retryableErrors).toContain('AUTH_ERROR')
    expect(DEFAULT_RETRY_POLICY.retryableErrors).toContain('NETWORK_ERROR')
  })
})

