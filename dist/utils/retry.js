"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Centralized retry logic with configurable policies
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSERVATIVE_RETRY_POLICY = exports.AGGRESSIVE_RETRY_POLICY = exports.DEFAULT_RETRY_POLICY = void 0;
exports.sleep = sleep;
exports.calculateBackoffDelay = calculateBackoffDelay;
exports.withRetry = withRetry;
exports.makeRetryable = makeRetryable;
exports.withRetryAndTimeout = withRetryAndTimeout;
exports.withRetryContext = withRetryContext;
const errors_1 = require("../errors");
/**
 * Default retry policy
 */
exports.DEFAULT_RETRY_POLICY = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableErrors: ['AUTH_ERROR', 'TOKEN_EXPIRED', 'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED'],
};
/**
 * Aggressive retry policy for critical operations
 */
exports.AGGRESSIVE_RETRY_POLICY = {
    maxAttempts: 5,
    baseDelay: 500,
    maxDelay: 60000,
    backoffMultiplier: 2,
    retryableErrors: ['AUTH_ERROR', 'TOKEN_EXPIRED', 'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMITED', 'API_ERROR'],
};
/**
 * Conservative retry policy for non-critical operations
 */
exports.CONSERVATIVE_RETRY_POLICY = {
    maxAttempts: 2,
    baseDelay: 2000,
    maxDelay: 10000,
    backoffMultiplier: 1.5,
    retryableErrors: ['NETWORK_ERROR', 'TIMEOUT'],
};
/**
 * Sleep for a specified duration
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateBackoffDelay(attempt, baseDelay, maxDelay, multiplier) {
    // Exponential backoff
    const exponentialDelay = baseDelay * Math.pow(multiplier, attempt - 1);
    // Add jitter (±25%)
    const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
    // Cap at max delay
    return Math.min(exponentialDelay + jitter, maxDelay);
}
/**
 * Execute a function with retry logic
 */
async function withRetry(fn, policy = {}) {
    const { maxAttempts, baseDelay, maxDelay, backoffMultiplier, retryableErrors, onRetry, } = { ...exports.DEFAULT_RETRY_POLICY, ...policy };
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            const errorCode = (0, errors_1.getErrorCode)(error);
            // Check if error is retryable
            const isRetryable = (0, errors_1.isRetryableError)(error) || retryableErrors.includes(errorCode);
            if (!isRetryable || attempt === maxAttempts) {
                throw error;
            }
            // Calculate delay
            let delay;
            if (error instanceof errors_1.RateLimitError) {
                // Use retry-after from rate limit error if available
                delay = error.retryAfter * 1000;
            }
            else {
                delay = calculateBackoffDelay(attempt, baseDelay, maxDelay, backoffMultiplier);
            }
            // Call retry callback if provided
            onRetry?.(attempt, error);
            // Wait before retrying
            await sleep(delay);
        }
    }
    throw lastError;
}
/**
 * Create a retryable version of a function
 */
function makeRetryable(fn, policy = {}) {
    return (...args) => withRetry(() => fn(...args), policy);
}
/**
 * Retry with timeout
 */
async function withRetryAndTimeout(fn, timeoutMs, policy = {}) {
    return withRetry(async () => {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        try {
            return await Promise.race([fn(), timeoutPromise]);
        }
        finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }, policy);
}
/**
 * Execute with retry and context logging
 */
async function withRetryContext(operation, fn, policy = {}, logger) {
    const mergedPolicy = { ...exports.DEFAULT_RETRY_POLICY, ...policy };
    const policyWithLogging = {
        ...mergedPolicy,
        onRetry: (attempt, error) => {
            const delay = calculateBackoffDelay(attempt, mergedPolicy.baseDelay, mergedPolicy.maxDelay, mergedPolicy.backoffMultiplier);
            logger?.({
                operation,
                attempt,
                maxAttempts: mergedPolicy.maxAttempts,
                error,
                delay,
            });
            mergedPolicy.onRetry?.(attempt, error);
        },
    };
    return withRetry(fn, policyWithLogging);
}
//# sourceMappingURL=retry.js.map