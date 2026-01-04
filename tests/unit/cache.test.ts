/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { ResponseCache, getResponseCache, resetGlobalCache } from '../../src/api/cache'

describe('ResponseCache', () => {
  beforeEach(() => {
    resetGlobalCache()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new ResponseCache()
      
      cache.set('key1', { data: 'value1' })
      
      expect(cache.get('key1')).toEqual({ data: 'value1' })
    })

    it('should return null for missing keys', () => {
      const cache = new ResponseCache()
      
      expect(cache.get('nonexistent')).toBeNull()
    })

    it('should check key existence', () => {
      const cache = new ResponseCache()
      
      cache.set('key1', 'value')
      
      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(false)
    })

    it('should delete keys', () => {
      const cache = new ResponseCache()
      
      cache.set('key1', 'value')
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeNull()
      expect(cache.delete('key1')).toBe(false)
    })

    it('should clear all keys', () => {
      const cache = new ResponseCache()
      
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      
      cache.clear()
      
      expect(cache.size).toBe(0)
      expect(cache.get('key1')).toBeNull()
    })
  })

  describe('TTL expiration', () => {
    it('should expire entries after TTL', () => {
      const cache = new ResponseCache({ ttlMs: 1000 })
      
      cache.set('key1', 'value')
      expect(cache.get('key1')).toBe('value')
      
      // Advance past TTL
      jest.advanceTimersByTime(1100)
      
      expect(cache.get('key1')).toBeNull()
    })

    it('should not return expired entries with has()', () => {
      const cache = new ResponseCache({ ttlMs: 1000 })
      
      cache.set('key1', 'value')
      
      jest.advanceTimersByTime(1100)
      
      expect(cache.has('key1')).toBe(false)
    })

    it('should clear expired entries', () => {
      const cache = new ResponseCache({ ttlMs: 1000 })
      
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      
      jest.advanceTimersByTime(1100)
      
      const cleared = cache.clearExpired()
      
      expect(cleared).toBe(2)
      expect(cache.size).toBe(0)
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entries when full', () => {
      const cache = new ResponseCache({ maxSize: 3, ttlMs: 60000 })
      
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      cache.set('key4', 'value4') // Should evict key1
      
      expect(cache.get('key1')).toBeNull()
      expect(cache.get('key4')).toBe('value4')
      expect(cache.size).toBe(3)
    })

    it('should update timestamp on access when configured', () => {
      const cache = new ResponseCache({ 
        maxSize: 2, 
        ttlMs: 60000,
        updateOnAccess: true,
      })
      
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      
      // Access key1 to update its timestamp
      cache.get('key1')
      
      // Add key3 - should evict key2 (oldest) not key1
      cache.set('key3', 'value3')
      
      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBeNull()
    })
  })

  describe('statistics', () => {
    it('should track hits and misses', () => {
      const cache = new ResponseCache()
      
      cache.set('key1', 'value1')
      
      cache.get('key1') // Hit
      cache.get('key1') // Hit
      cache.get('key2') // Miss
      
      const stats = cache.getStats()
      
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(1)
      expect(stats.hitRatio).toBeCloseTo(2/3)
    })

    it('should reset statistics', () => {
      const cache = new ResponseCache()
      
      cache.set('key1', 'value1')
      cache.get('key1')
      cache.get('key2')
      
      cache.resetStats()
      
      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })

    it('should handle zero total for hit ratio', () => {
      const cache = new ResponseCache()
      
      expect(cache.hitRatio).toBe(0)
    })
  })

  describe('getOrSet', () => {
    it('should return cached value if present', async () => {
      const cache = new ResponseCache()
      const factory = jest.fn().mockResolvedValue('new')
      
      cache.set('key1', 'cached')
      
      const result = await cache.getOrSet('key1', factory)
      
      expect(result).toBe('cached')
      expect(factory).not.toHaveBeenCalled()
    })

    it('should call factory and cache result if missing', async () => {
      const cache = new ResponseCache()
      const factory = jest.fn().mockResolvedValue('new')
      
      const result = await cache.getOrSet('key1', factory)
      
      expect(result).toBe('new')
      expect(factory).toHaveBeenCalled()
      expect(cache.get('key1')).toBe('new')
    })
  })

  describe('keys', () => {
    it('should return all keys', () => {
      const cache = new ResponseCache()
      
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      
      const keys = cache.keys()
      
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys.length).toBe(2)
    })
  })

  describe('global cache', () => {
    it('should return same instance', () => {
      const cache1 = getResponseCache()
      const cache2 = getResponseCache()
      
      expect(cache1).toBe(cache2)
    })

    it('should reset properly', () => {
      const cache1 = getResponseCache()
      resetGlobalCache()
      const cache2 = getResponseCache()
      
      expect(cache1).not.toBe(cache2)
    })
  })
})

