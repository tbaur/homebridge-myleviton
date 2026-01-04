/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Response caching with TTL and LRU eviction
 */
/**
 * Cache configuration
 */
export interface CacheConfig {
    /** Time-to-live in milliseconds */
    ttlMs: number;
    /** Maximum number of entries */
    maxSize: number;
    /** Whether to update timestamp on access */
    updateOnAccess?: boolean;
}
/**
 * Default cache configuration
 */
export declare const DEFAULT_CACHE_CONFIG: CacheConfig;
/**
 * Response cache with TTL and optional LRU eviction
 */
export declare class ResponseCache<T = unknown> {
    private readonly cache;
    private readonly ttlMs;
    private readonly maxSize;
    private readonly updateOnAccess;
    private hits;
    private misses;
    constructor(config?: Partial<CacheConfig>);
    /**
     * Check if entry is expired
     */
    private isExpired;
    /**
     * Evict oldest entries if over capacity
     */
    private evictIfNeeded;
    /**
     * Get cached value if still valid
     * @returns Cached data or null if expired/missing
     */
    get(key: string): T | null;
    /**
     * Set cache value
     */
    set(key: string, data: T): void;
    /**
     * Check if key exists and is not expired
     */
    has(key: string): boolean;
    /**
     * Delete a specific key
     */
    delete(key: string): boolean;
    /**
     * Clear expired entries
     */
    clearExpired(): number;
    /**
     * Clear all cache entries
     */
    clear(): void;
    /**
     * Get number of entries
     */
    get size(): number;
    /**
     * Get cache hit ratio
     */
    get hitRatio(): number;
    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        maxSize: number;
        ttlMs: number;
        hits: number;
        misses: number;
        hitRatio: number;
    };
    /**
     * Reset statistics
     */
    resetStats(): void;
    /**
     * Get all keys
     */
    keys(): string[];
    /**
     * Get or set a value using a factory function
     */
    getOrSet(key: string, factory: () => Promise<T>): Promise<T>;
}
/**
 * Get or create the global cache
 */
export declare function getResponseCache(config?: Partial<CacheConfig>): ResponseCache;
/**
 * Reset the global cache (for testing)
 */
export declare function resetGlobalCache(): void;
//# sourceMappingURL=cache.d.ts.map