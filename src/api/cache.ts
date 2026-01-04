/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Response caching with TTL and LRU eviction
 */

import type { CacheEntry } from '../types'

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Time-to-live in milliseconds */
  ttlMs: number
  /** Maximum number of entries */
  maxSize: number
  /** Whether to update timestamp on access */
  updateOnAccess?: boolean
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttlMs: 2000, // 2 seconds
  maxSize: 1000,
  updateOnAccess: false,
}

/**
 * Response cache with TTL and optional LRU eviction
 */
export class ResponseCache<T = unknown> {
  private readonly cache: Map<string, CacheEntry<T>> = new Map()
  private readonly ttlMs: number
  private readonly maxSize: number
  private readonly updateOnAccess: boolean

  // Metrics
  private hits = 0
  private misses = 0

  constructor(config: Partial<CacheConfig> = {}) {
    const merged = { ...DEFAULT_CACHE_CONFIG, ...config }
    this.ttlMs = merged.ttlMs
    this.maxSize = merged.maxSize
    this.updateOnAccess = merged.updateOnAccess ?? false
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > this.ttlMs
  }

  /**
   * Evict oldest entries if over capacity
   */
  private evictIfNeeded(): void {
    while (this.cache.size >= this.maxSize) {
      // Remove oldest entry (first in map)
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      } else {
        break
      }
    }
  }

  /**
   * Get cached value if still valid
   * @returns Cached data or null if expired/missing
   */
  get(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return null
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key)
      this.misses++
      return null
    }

    this.hits++

    // Optionally update timestamp on access (LRU-style)
    if (this.updateOnAccess) {
      entry.timestamp = Date.now()
      // Move to end of map for LRU ordering
      this.cache.delete(key)
      this.cache.set(key, entry)
    }

    return entry.data
  }

  /**
   * Set cache value
   */
  set(key: string, data: T): void {
    this.evictIfNeeded()
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) {return false}
    if (this.isExpired(entry)) {
      this.cache.delete(key)
      return false
    }
    return true
  }

  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Clear expired entries
   */
  clearExpired(): number {
    let cleared = 0
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key)
        cleared++
      }
    }
    return cleared
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get number of entries
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get cache hit ratio
   */
  get hitRatio(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : this.hits / total
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number
    maxSize: number
    ttlMs: number
    hits: number
    misses: number
    hitRatio: number
  } {
    return {
      size: this.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      hitRatio: this.hitRatio,
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Get or set a value using a factory function
   */
  async getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.get(key)
    if (cached !== null) {
      return cached
    }

    const data = await factory()
    this.set(key, data)
    return data
  }
}

/**
 * Global response cache instance
 */
let globalCache: ResponseCache | null = null

/**
 * Get or create the global cache
 */
export function getResponseCache(config?: Partial<CacheConfig>): ResponseCache {
  if (!globalCache) {
    globalCache = new ResponseCache(config)
  }
  return globalCache
}

/**
 * Reset the global cache (for testing)
 */
export function resetGlobalCache(): void {
  globalCache = null
}

