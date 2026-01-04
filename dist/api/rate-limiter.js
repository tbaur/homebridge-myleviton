"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Token bucket rate limiter for API requests
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = exports.DEFAULT_RATE_LIMITER_CONFIG = void 0;
exports.getRateLimiter = getRateLimiter;
exports.resetGlobalRateLimiter = resetGlobalRateLimiter;
const errors_1 = require("../errors");
const retry_1 = require("../utils/retry");
/**
 * Default rate limiter configuration
 * Leviton allows max 99 devices per residence, 20 residences per account
 * At startup: 99 devices × 2 queries (power + brightness) = 198 requests
 * Rate limiter only applies to WRITE operations
 */
exports.DEFAULT_RATE_LIMITER_CONFIG = {
    maxRequests: 300,
    windowMs: 60000, // 1 minute
    waitOnLimit: false,
    maxWaitMs: 30000,
};
/**
 * Token bucket rate limiter
 * Prevents overwhelming the Leviton API with too many requests
 */
class RateLimiter {
    maxRequests;
    windowMs;
    waitOnLimit;
    maxWaitMs;
    requests = [];
    constructor(config = {}) {
        const merged = { ...exports.DEFAULT_RATE_LIMITER_CONFIG, ...config };
        this.maxRequests = merged.maxRequests;
        this.windowMs = merged.windowMs;
        this.waitOnLimit = merged.waitOnLimit ?? false;
        this.maxWaitMs = merged.maxWaitMs ?? 30000;
    }
    /**
     * Clean up expired request timestamps
     */
    cleanup() {
        const now = Date.now();
        this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);
    }
    /**
     * Get current request count in window
     */
    get currentCount() {
        this.cleanup();
        return this.requests.length;
    }
    /**
     * Get remaining requests in window
     */
    get remaining() {
        return Math.max(0, this.maxRequests - this.currentCount);
    }
    /**
     * Get time until window resets (oldest request expires)
     */
    get resetTime() {
        if (this.requests.length === 0) {
            return 0;
        }
        const oldest = Math.min(...this.requests);
        return Math.max(0, this.windowMs - (Date.now() - oldest));
    }
    /**
     * Check if a request can be made without blocking
     */
    canAcquire() {
        this.cleanup();
        return this.requests.length < this.maxRequests;
    }
    /**
     * Try to acquire a request token
     * @returns true if acquired, false if rate limited
     */
    tryAcquire() {
        this.cleanup();
        if (this.requests.length >= this.maxRequests) {
            return false;
        }
        this.requests.push(Date.now());
        return true;
    }
    /**
     * Acquire a request token, throwing if rate limited
     * @throws RateLimitError if rate limited and waitOnLimit is false
     */
    acquire() {
        if (!this.tryAcquire()) {
            const retryAfter = Math.ceil(this.resetTime / 1000);
            throw new errors_1.RateLimitError(`Rate limit exceeded. ${this.maxRequests} requests per ${this.windowMs / 1000}s`, retryAfter);
        }
    }
    /**
     * Acquire a request token, waiting if necessary
     * @throws RateLimitError if wait exceeds maxWaitMs
     */
    async acquireAsync() {
        const startTime = Date.now();
        while (!this.tryAcquire()) {
            const elapsed = Date.now() - startTime;
            if (elapsed >= this.maxWaitMs) {
                throw new errors_1.RateLimitError(`Rate limit wait exceeded ${this.maxWaitMs}ms`, Math.ceil((this.maxWaitMs - elapsed) / 1000));
            }
            // Wait for the oldest request to expire
            const waitTime = Math.min(this.resetTime, this.maxWaitMs - elapsed, 1000);
            if (waitTime > 0) {
                await (0, retry_1.sleep)(waitTime);
            }
        }
    }
    /**
     * Execute a function with rate limiting
     */
    async execute(fn) {
        if (this.waitOnLimit) {
            await this.acquireAsync();
        }
        else {
            this.acquire();
        }
        return fn();
    }
    /**
     * Reset the rate limiter
     */
    reset() {
        this.requests = [];
    }
    /**
     * Get rate limiter status for monitoring
     */
    getStatus() {
        return {
            currentCount: this.currentCount,
            maxRequests: this.maxRequests,
            remaining: this.remaining,
            resetTime: this.resetTime,
            windowMs: this.windowMs,
        };
    }
}
exports.RateLimiter = RateLimiter;
/**
 * Global rate limiter instance
 */
let globalRateLimiter = null;
/**
 * Get or create the global rate limiter
 */
function getRateLimiter(config) {
    if (!globalRateLimiter) {
        globalRateLimiter = new RateLimiter(config);
    }
    return globalRateLimiter;
}
/**
 * Reset the global rate limiter (for testing)
 */
function resetGlobalRateLimiter() {
    globalRateLimiter = null;
}
//# sourceMappingURL=rate-limiter.js.map