/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Token bucket rate limiter for API requests
 */
/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
    /** Maximum requests per window */
    maxRequests: number;
    /** Window duration in milliseconds */
    windowMs: number;
    /** Whether to wait when rate limited (vs throwing immediately) */
    waitOnLimit?: boolean;
    /** Maximum wait time when waitOnLimit is true */
    maxWaitMs?: number;
}
/**
 * Default rate limiter configuration
 * Leviton allows max 99 devices per residence, 20 residences per account
 * At startup: 99 devices × 2 queries (power + brightness) = 198 requests
 * Rate limiter only applies to WRITE operations
 */
export declare const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig;
/**
 * Token bucket rate limiter
 * Prevents overwhelming the Leviton API with too many requests
 */
export declare class RateLimiter {
    private readonly maxRequests;
    private readonly windowMs;
    private readonly waitOnLimit;
    private readonly maxWaitMs;
    private requests;
    constructor(config?: Partial<RateLimiterConfig>);
    /**
     * Clean up expired request timestamps
     */
    private cleanup;
    /**
     * Get current request count in window
     */
    get currentCount(): number;
    /**
     * Get remaining requests in window
     */
    get remaining(): number;
    /**
     * Get time until window resets (oldest request expires)
     */
    get resetTime(): number;
    /**
     * Check if a request can be made without blocking
     */
    canAcquire(): boolean;
    /**
     * Try to acquire a request token
     * @returns true if acquired, false if rate limited
     */
    tryAcquire(): boolean;
    /**
     * Acquire a request token, throwing if rate limited
     * @throws RateLimitError if rate limited and waitOnLimit is false
     */
    acquire(): void;
    /**
     * Acquire a request token, waiting if necessary
     * @throws RateLimitError if wait exceeds maxWaitMs
     */
    acquireAsync(): Promise<void>;
    /**
     * Execute a function with rate limiting
     */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Reset the rate limiter
     */
    reset(): void;
    /**
     * Get rate limiter status for monitoring
     */
    getStatus(): {
        currentCount: number;
        maxRequests: number;
        remaining: number;
        resetTime: number;
        windowMs: number;
    };
}
/**
 * Get or create the global rate limiter
 */
export declare function getRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter;
/**
 * Reset the global rate limiter (for testing)
 */
export declare function resetGlobalRateLimiter(): void;
//# sourceMappingURL=rate-limiter.d.ts.map