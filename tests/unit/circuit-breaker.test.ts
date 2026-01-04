/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { 
  CircuitBreaker, 
  CircuitState, 
  getCircuitBreaker, 
  resetGlobalCircuitBreaker, 
} from '../../src/api/circuit-breaker'
import { CircuitBreakerError } from '../../src/errors'

describe('CircuitBreaker', () => {
  beforeEach(() => {
    resetGlobalCircuitBreaker()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      const breaker = new CircuitBreaker()
      
      expect(breaker.state).toBe(CircuitState.CLOSED)
      expect(breaker.isOpen).toBe(false)
    })

    it('should allow requests when closed', () => {
      const breaker = new CircuitBreaker()
      
      expect(breaker.canRequest()).toBe(true)
    })
  })

  describe('failure tracking', () => {
    it('should open after threshold failures', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 })
      
      breaker.recordFailure()
      breaker.recordFailure()
      expect(breaker.state).toBe(CircuitState.CLOSED)
      
      breaker.recordFailure()
      expect(breaker.state).toBe(CircuitState.OPEN)
      expect(breaker.isOpen).toBe(true)
    })

    it('should block requests when open', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 })
      
      breaker.recordFailure()
      
      expect(breaker.canRequest()).toBe(false)
    })

    it('should expire old failures', () => {
      const breaker = new CircuitBreaker({ 
        failureThreshold: 3,
        failureWindow: 1000,
      })
      
      breaker.recordFailure()
      breaker.recordFailure()
      
      // Advance past failure window
      jest.advanceTimersByTime(1100)
      
      breaker.recordSuccess() // Triggers cleanup
      
      // Old failures should be expired
      const status = breaker.getStatus()
      expect(status.failures).toBe(0)
    })
  })

  describe('half-open state', () => {
    it('should transition to half-open after reset timeout', () => {
      const breaker = new CircuitBreaker({ 
        failureThreshold: 1,
        resetTimeout: 1000,
      })
      
      breaker.recordFailure()
      expect(breaker.state).toBe(CircuitState.OPEN)
      
      // Advance past reset timeout
      jest.advanceTimersByTime(1100)
      
      // Should allow test request
      expect(breaker.canRequest()).toBe(true)
      expect(breaker.state).toBe(CircuitState.HALF_OPEN)
    })

    it('should limit requests in half-open', () => {
      const breaker = new CircuitBreaker({ 
        failureThreshold: 1,
        resetTimeout: 1000,
        halfOpenMax: 2,
      })
      
      breaker.recordFailure()
      jest.advanceTimersByTime(1100)
      
      // First requests allowed
      expect(breaker.canRequest()).toBe(true)
      breaker.trackHalfOpenRequest()
      expect(breaker.canRequest()).toBe(true)
      breaker.trackHalfOpenRequest()
      
      // Third blocked
      expect(breaker.canRequest()).toBe(false)
    })

    it('should close after enough successes in half-open', () => {
      const breaker = new CircuitBreaker({ 
        failureThreshold: 1,
        resetTimeout: 1000,
        halfOpenMax: 2,
      })
      
      breaker.recordFailure()
      jest.advanceTimersByTime(1100)
      breaker.canRequest() // Trigger half-open
      
      breaker.recordSuccess()
      expect(breaker.state).toBe(CircuitState.HALF_OPEN)
      
      breaker.recordSuccess()
      expect(breaker.state).toBe(CircuitState.CLOSED)
    })

    it('should re-open on failure in half-open', () => {
      const breaker = new CircuitBreaker({ 
        failureThreshold: 1,
        resetTimeout: 1000,
      })
      
      breaker.recordFailure()
      jest.advanceTimersByTime(1100)
      breaker.canRequest() // Trigger half-open
      
      breaker.recordFailure()
      
      expect(breaker.state).toBe(CircuitState.OPEN)
    })
  })

  describe('execute', () => {
    it('should execute function when closed', async () => {
      const breaker = new CircuitBreaker()
      const fn = jest.fn().mockResolvedValue('result')
      
      const result = await breaker.execute(fn)
      
      expect(result).toBe('result')
      expect(fn).toHaveBeenCalled()
    })

    it('should record success on success', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 })
      const fn = jest.fn().mockResolvedValue('result')
      
      // Create some failures first
      breaker.recordFailure()
      
      await breaker.execute(fn)
      
      // Success should have cleaned up failures
      const status = breaker.getStatus()
      expect(status.state).toBe(CircuitState.CLOSED)
    })

    it('should record failure on error', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 })
      const fn = jest.fn().mockRejectedValue(new Error('failed'))
      
      await expect(breaker.execute(fn)).rejects.toThrow('failed')
      await expect(breaker.execute(fn)).rejects.toThrow('failed')
      
      expect(breaker.state).toBe(CircuitState.OPEN)
    })

    it('should throw CircuitBreakerError when open', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 })
      const fn = jest.fn().mockResolvedValue('result')
      
      breaker.recordFailure()
      
      await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerError)
      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('wrap', () => {
    it('should wrap function with circuit breaker', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 })
      const fn = jest.fn().mockResolvedValue('result')
      const wrapped = breaker.wrap(fn)
      
      const result = await wrapped('arg1', 'arg2')
      
      expect(result).toBe('result')
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
    })
  })

  describe('reset', () => {
    it('should reset all state', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 })
      
      breaker.recordFailure()
      expect(breaker.state).toBe(CircuitState.OPEN)
      
      breaker.reset()
      
      expect(breaker.state).toBe(CircuitState.CLOSED)
      expect(breaker.isOpen).toBe(false)
      expect(breaker.getStatus().failures).toBe(0)
    })
  })

  describe('getStatus', () => {
    it('should return complete status', () => {
      const breaker = new CircuitBreaker({ 
        failureThreshold: 5,
        resetTimeout: 30000,
      })
      
      breaker.recordFailure()
      breaker.recordFailure()
      
      const status = breaker.getStatus()
      
      expect(status).toEqual({
        state: CircuitState.CLOSED,
        failures: 2,
        successes: 0,
        lastFailureTime: expect.any(Number),
        halfOpenRequests: 0,
        isOpen: false,
        remainingResetTime: null,
      })
    })

    it('should include remainingResetTime when open', () => {
      const breaker = new CircuitBreaker({ 
        failureThreshold: 1,
        resetTimeout: 30000,
      })
      
      breaker.recordFailure()
      
      const status = breaker.getStatus()
      
      expect(status.remainingResetTime).toBeGreaterThan(0)
      expect(status.remainingResetTime).toBeLessThanOrEqual(30000)
    })
  })

  describe('global circuit breaker', () => {
    it('should return same instance', () => {
      const breaker1 = getCircuitBreaker()
      const breaker2 = getCircuitBreaker()
      
      expect(breaker1).toBe(breaker2)
    })

    it('should reset properly', () => {
      const breaker1 = getCircuitBreaker()
      resetGlobalCircuitBreaker()
      const breaker2 = getCircuitBreaker()
      
      expect(breaker1).not.toBe(breaker2)
    })
  })
})

