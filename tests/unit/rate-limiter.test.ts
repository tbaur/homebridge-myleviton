/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { RateLimiter, getRateLimiter, resetGlobalRateLimiter } from '../../src/api/rate-limiter'
import { RateLimitError } from '../../src/errors'

describe('RateLimiter', () => {
  beforeEach(() => {
    resetGlobalRateLimiter()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('basic functionality', () => {
    it('should allow requests under limit', () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 })
      
      expect(limiter.tryAcquire()).toBe(true)
      expect(limiter.tryAcquire()).toBe(true)
      expect(limiter.tryAcquire()).toBe(true)
      expect(limiter.currentCount).toBe(3)
    })

    it('should block requests over limit', () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 })
      
      limiter.tryAcquire()
      limiter.tryAcquire()
      
      expect(limiter.tryAcquire()).toBe(false)
      expect(limiter.canAcquire()).toBe(false)
    })

    it('should release requests after window expires', () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 })
      
      limiter.tryAcquire()
      limiter.tryAcquire()
      expect(limiter.canAcquire()).toBe(false)
      
      // Advance past window
      jest.advanceTimersByTime(1100)
      
      expect(limiter.canAcquire()).toBe(true)
      expect(limiter.tryAcquire()).toBe(true)
    })
  })

  describe('acquire', () => {
    it('should throw RateLimitError when over limit', () => {
      const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 })
      
      limiter.acquire()
      
      expect(() => limiter.acquire()).toThrow(RateLimitError)
    })

    it('should include retryAfter in error', () => {
      const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 })
      
      limiter.acquire()
      
      try {
        limiter.acquire()
        fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError)
        expect((e as RateLimitError).retryAfter).toBeGreaterThan(0)
      }
    })
  })

  describe('acquireAsync', () => {
    it('should wait when over limit', async () => {
      const limiter = new RateLimiter({ 
        maxRequests: 1, 
        windowMs: 100,
        waitOnLimit: true,
        maxWaitMs: 500,
      })
      
      limiter.tryAcquire()
      
      const promise = limiter.acquireAsync()
      
      // Advance time to allow request to proceed
      jest.advanceTimersByTime(150)
      
      await expect(promise).resolves.toBeUndefined()
    })

    it('should throw after maxWaitMs', async () => {
      jest.useRealTimers() // Need real timers for this test
      
      const limiter = new RateLimiter({ 
        maxRequests: 1, 
        windowMs: 5000,
        waitOnLimit: true,
        maxWaitMs: 100,
      })
      
      limiter.tryAcquire()
      
      await expect(limiter.acquireAsync()).rejects.toThrow(RateLimitError)
    })
  })

  describe('execute', () => {
    it('should execute function when under limit', async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 })
      const fn = jest.fn().mockResolvedValue('result')
      
      const result = await limiter.execute(fn)
      
      expect(result).toBe('result')
      expect(fn).toHaveBeenCalled()
    })

    it('should throw when over limit', async () => {
      const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 })
      const fn = jest.fn().mockResolvedValue('result')
      
      await limiter.execute(fn)
      
      await expect(limiter.execute(fn)).rejects.toThrow(RateLimitError)
    })
  })

  describe('remaining and resetTime', () => {
    it('should track remaining requests', () => {
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 })
      
      expect(limiter.remaining).toBe(3)
      
      limiter.tryAcquire()
      expect(limiter.remaining).toBe(2)
      
      limiter.tryAcquire()
      limiter.tryAcquire()
      expect(limiter.remaining).toBe(0)
    })

    it('should calculate reset time', () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 })
      
      limiter.tryAcquire()
      
      // Reset time should be close to windowMs
      expect(limiter.resetTime).toBeGreaterThan(0)
      expect(limiter.resetTime).toBeLessThanOrEqual(1000)
    })
  })

  describe('reset', () => {
    it('should clear all requests', () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 })
      
      limiter.tryAcquire()
      limiter.tryAcquire()
      expect(limiter.currentCount).toBe(2)
      
      limiter.reset()
      
      expect(limiter.currentCount).toBe(0)
      expect(limiter.remaining).toBe(2)
    })
  })

  describe('getStatus', () => {
    it('should return complete status', () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 })
      
      limiter.tryAcquire()
      limiter.tryAcquire()
      
      const status = limiter.getStatus()
      
      expect(status).toEqual({
        currentCount: 2,
        maxRequests: 5,
        remaining: 3,
        resetTime: expect.any(Number),
        windowMs: 1000,
      })
    })
  })

  describe('global rate limiter', () => {
    it('should return same instance', () => {
      const limiter1 = getRateLimiter()
      const limiter2 = getRateLimiter()
      
      expect(limiter1).toBe(limiter2)
    })

    it('should reset properly', () => {
      const limiter1 = getRateLimiter()
      resetGlobalRateLimiter()
      const limiter2 = getRateLimiter()
      
      expect(limiter1).not.toBe(limiter2)
    })
  })
})

