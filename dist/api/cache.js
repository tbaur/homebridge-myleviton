"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Response caching with TTL and LRU eviction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseCache = exports.DEFAULT_CACHE_CONFIG = void 0;
exports.getResponseCache = getResponseCache;
exports.resetGlobalCache = resetGlobalCache;
/**
 * Default cache configuration
 */
exports.DEFAULT_CACHE_CONFIG = {
    ttlMs: 2000, // 2 seconds
    maxSize: 1000,
    updateOnAccess: false,
};
/**
 * Response cache with TTL and optional LRU eviction
 */
class ResponseCache {
    cache = new Map();
    ttlMs;
    maxSize;
    updateOnAccess;
    // Metrics
    hits = 0;
    misses = 0;
    constructor(config = {}) {
        const merged = { ...exports.DEFAULT_CACHE_CONFIG, ...config };
        this.ttlMs = merged.ttlMs;
        this.maxSize = merged.maxSize;
        this.updateOnAccess = merged.updateOnAccess ?? false;
    }
    /**
     * Check if entry is expired
     */
    isExpired(entry) {
        return Date.now() - entry.timestamp > this.ttlMs;
    }
    /**
     * Evict oldest entries if over capacity
     */
    evictIfNeeded() {
        while (this.cache.size >= this.maxSize) {
            // Remove oldest entry (first in map)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
            else {
                break;
            }
        }
    }
    /**
     * Get cached value if still valid
     * @returns Cached data or null if expired/missing
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }
        if (this.isExpired(entry)) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }
        this.hits++;
        // Optionally update timestamp on access (LRU-style)
        if (this.updateOnAccess) {
            entry.timestamp = Date.now();
            // Move to end of map for LRU ordering
            this.cache.delete(key);
            this.cache.set(key, entry);
        }
        return entry.data;
    }
    /**
     * Set cache value
     */
    set(key, data) {
        this.evictIfNeeded();
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
        });
    }
    /**
     * Check if key exists and is not expired
     */
    has(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }
        if (this.isExpired(entry)) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    /**
     * Delete a specific key
     */
    delete(key) {
        return this.cache.delete(key);
    }
    /**
     * Clear expired entries
     */
    clearExpired() {
        let cleared = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (this.isExpired(entry)) {
                this.cache.delete(key);
                cleared++;
            }
        }
        return cleared;
    }
    /**
     * Clear all cache entries
     */
    clear() {
        this.cache.clear();
    }
    /**
     * Get number of entries
     */
    get size() {
        return this.cache.size;
    }
    /**
     * Get cache hit ratio
     */
    get hitRatio() {
        const total = this.hits + this.misses;
        return total === 0 ? 0 : this.hits / total;
    }
    /**
     * Get cache statistics
     */
    getStats() {
        return {
            size: this.size,
            maxSize: this.maxSize,
            ttlMs: this.ttlMs,
            hits: this.hits,
            misses: this.misses,
            hitRatio: this.hitRatio,
        };
    }
    /**
     * Reset statistics
     */
    resetStats() {
        this.hits = 0;
        this.misses = 0;
    }
    /**
     * Get all keys
     */
    keys() {
        return Array.from(this.cache.keys());
    }
    /**
     * Get or set a value using a factory function
     */
    async getOrSet(key, factory) {
        const cached = this.get(key);
        if (cached !== null) {
            return cached;
        }
        const data = await factory();
        this.set(key, data);
        return data;
    }
}
exports.ResponseCache = ResponseCache;
/**
 * Global response cache instance
 */
let globalCache = null;
/**
 * Get or create the global cache
 */
function getResponseCache(config) {
    if (!globalCache) {
        globalCache = new ResponseCache(config);
    }
    return globalCache;
}
/**
 * Reset the global cache (for testing)
 */
function resetGlobalCache() {
    globalCache = null;
}
//# sourceMappingURL=cache.js.map