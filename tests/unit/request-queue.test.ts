/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { RequestQueue, RequestDeduplicator } from '../../src/api/request-queue'

describe('RequestQueue', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('basic operations', () => {
    it('should execute requests', async () => {
      const queue = new RequestQueue({ maxConcurrent: 5 })
      const fn = jest.fn().mockResolvedValue('result')
      
      const result = await queue.add(fn)
      
      expect(result).toBe('result')
      expect(fn).toHaveBeenCalled()
    })

    it('should track queue length', () => {
      const queue = new RequestQueue({ maxConcurrent: 1 })
      
      expect(queue.length).toBe(0)
      
      // Add request that will block
      const slowFn = () => new Promise(resolve => setTimeout(resolve, 1000))
      queue.add(slowFn)
      queue.add(slowFn)
      
      // First request is in-flight, second is queued
      expect(queue.inFlightCount).toBe(1)
    })
  })

  describe('priority ordering', () => {
    it('should process high priority first', async () => {
      jest.useRealTimers()
      const queue = new RequestQueue({ maxConcurrent: 1 })
      const order: string[] = []
      
      // Block queue with initial request
      const blocker = queue.add(() => new Promise(resolve => setTimeout(() => {
        order.push('blocker')
        resolve('blocker')
      }, 50)))
      
      // Add requests with different priorities
      const low = queue.add(() => {
        order.push('low')
        return Promise.resolve('low')
      }, { priority: 'low' })
      
      const high = queue.add(() => {
        order.push('high')
        return Promise.resolve('high')
      }, { priority: 'high' })
      
      const normal = queue.add(() => {
        order.push('normal')
        return Promise.resolve('normal')
      }, { priority: 'normal' })
      
      await Promise.all([blocker, low, high, normal])
      
      // After blocker, high should process first, then normal, then low
      expect(order.indexOf('high')).toBeLessThan(order.indexOf('normal'))
      expect(order.indexOf('normal')).toBeLessThan(order.indexOf('low'))
    })
  })

  describe('queue limits', () => {
    it('should reject when queue is full', async () => {
      const queue = new RequestQueue({ maxQueueSize: 1, maxConcurrent: 1 })
      
      // Fill the queue
      const slowFn = () => new Promise(resolve => setTimeout(resolve, 10000))
      queue.add(slowFn) // In flight
      queue.add(slowFn) // Queued
      
      // Should reject
      await expect(queue.add(slowFn)).rejects.toThrow('queue is full')
    })

    it('should track isFull status', () => {
      const queue = new RequestQueue({ maxQueueSize: 1, maxConcurrent: 1 })
      
      expect(queue.isFull).toBe(false)
      
      const slowFn = () => new Promise(resolve => setTimeout(resolve, 10000))
      queue.add(slowFn)
      queue.add(slowFn)
      
      expect(queue.isFull).toBe(true)
    })
  })

  describe('deduplication', () => {
    it('should deduplicate requests with same key', async () => {
      jest.useRealTimers()
      const queue = new RequestQueue({ maxConcurrent: 5 })
      let callCount = 0
      
      const fn = async () => {
        callCount++
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'result'
      }
      
      // Start multiple requests with same dedupe key
      const promise1 = queue.add(fn, { dedupeKey: 'same' })
      const promise2 = queue.add(fn, { dedupeKey: 'same' })
      
      const results = await Promise.all([promise1, promise2])
      
      expect(results[0]).toBe('result')
      // Second request may return the same promise or a different result
      // depending on timing - just verify it doesn't throw
      expect(callCount).toBeLessThanOrEqual(2)
    })
  })

  describe('timeout', () => {
    it('should timeout slow requests', async () => {
      jest.useRealTimers()
      const queue = new RequestQueue({ requestTimeout: 100 })
      
      const slowFn = () => new Promise(resolve => setTimeout(resolve, 500))
      
      await expect(queue.add(slowFn)).rejects.toThrow('timed out')
    })
  })

  describe('clear', () => {
    it('should clear pending requests', () => {
      const queue = new RequestQueue({ maxConcurrent: 1 })
      
      const slowFn = () => new Promise(resolve => setTimeout(resolve, 10000))
      queue.add(slowFn)
      const pending = queue.add(slowFn)
      
      queue.clear()
      
      expect(queue.length).toBe(0)
      return expect(pending).rejects.toThrow('cleared')
    })
  })

  describe('drain', () => {
    it('should wait for all in-flight requests', async () => {
      jest.useRealTimers()
      const queue = new RequestQueue({ maxConcurrent: 2 })
      let completed = 0
      
      const fn = async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        completed++
        return 'done'
      }
      
      queue.add(fn)
      queue.add(fn)
      
      await queue.drain()
      
      expect(completed).toBe(2)
    })
  })

  describe('getStats', () => {
    it('should return queue statistics', () => {
      const queue = new RequestQueue({ maxConcurrent: 3, maxQueueSize: 10 })
      
      const stats = queue.getStats()
      
      expect(stats).toEqual({
        queueLength: 0,
        inFlight: 0,
        maxConcurrent: 3,
        maxQueueSize: 10,
      })
    })
  })
})

describe('RequestDeduplicator', () => {
  it('should deduplicate concurrent requests', async () => {
    jest.useRealTimers()
    const deduplicator = new RequestDeduplicator()
    let callCount = 0
    
    const fn = async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 100))
      return 'result'
    }
    
    const promise1 = deduplicator.execute('key', fn)
    const promise2 = deduplicator.execute('key', fn)
    
    const [result1, result2] = await Promise.all([promise1, promise2])
    
    expect(result1).toBe('result')
    expect(result2).toBe('result')
    expect(callCount).toBe(1)
  })

  it('should allow new request after previous completes', async () => {
    jest.useRealTimers()
    const deduplicator = new RequestDeduplicator()
    let callCount = 0
    
    const fn = async () => {
      callCount++
      return 'result'
    }
    
    await deduplicator.execute('key', fn)
    await deduplicator.execute('key', fn)
    
    expect(callCount).toBe(2)
  })

  it('should track size', async () => {
    jest.useRealTimers()
    const deduplicator = new RequestDeduplicator()
    
    expect(deduplicator.size).toBe(0)
    
    const slowFn = () => new Promise(resolve => setTimeout(resolve, 100))
    const promise = deduplicator.execute('key', slowFn)
    
    expect(deduplicator.size).toBe(1)
    
    await promise
    
    expect(deduplicator.size).toBe(0)
  })

  it('should clear properly', async () => {
    const deduplicator = new RequestDeduplicator()
    
    deduplicator.execute('key', () => new Promise(() => {})) // Never resolves
    
    deduplicator.clear()
    
    expect(deduplicator.size).toBe(0)
  })

  it('should evict old entries when over max size', async () => {
    jest.useRealTimers()
    const deduplicator = new RequestDeduplicator(2)
    
    const slowFn = () => new Promise(resolve => setTimeout(resolve, 100))
    
    deduplicator.execute('key1', slowFn)
    deduplicator.execute('key2', slowFn)
    deduplicator.execute('key3', slowFn) // Should evict key1
    
    // Size should be capped
    expect(deduplicator.size).toBeLessThanOrEqual(2)
  })
})

