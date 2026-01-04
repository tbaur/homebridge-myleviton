/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Centralized retry logic with configurable policies
 */
import type { RetryPolicy } from '../types';
/**
 * Default retry policy
 */
export declare const DEFAULT_RETRY_POLICY: RetryPolicy;
/**
 * Aggressive retry policy for critical operations
 */
export declare const AGGRESSIVE_RETRY_POLICY: RetryPolicy;
/**
 * Conservative retry policy for non-critical operations
 */
export declare const CONSERVATIVE_RETRY_POLICY: RetryPolicy;
/**
 * Sleep for a specified duration
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Calculate delay with exponential backoff and jitter
 */
export declare function calculateBackoffDelay(attempt: number, baseDelay: number, maxDelay: number, multiplier: number): number;
/**
 * Execute a function with retry logic
 */
export declare function withRetry<T>(fn: () => Promise<T>, policy?: Partial<RetryPolicy>): Promise<T>;
/**
 * Create a retryable version of a function
 */
export declare function makeRetryable<T extends unknown[], R>(fn: (...args: T) => Promise<R>, policy?: Partial<RetryPolicy>): (...args: T) => Promise<R>;
/**
 * Retry with timeout
 */
export declare function withRetryAndTimeout<T>(fn: () => Promise<T>, timeoutMs: number, policy?: Partial<RetryPolicy>): Promise<T>;
/**
 * Context for retry operations (for logging)
 */
export interface RetryContext {
    operation: string;
    attempt: number;
    maxAttempts: number;
    error?: Error;
    delay?: number;
}
/**
 * Execute with retry and context logging
 */
export declare function withRetryContext<T>(operation: string, fn: () => Promise<T>, policy?: Partial<RetryPolicy>, logger?: (context: RetryContext) => void): Promise<T>;
//# sourceMappingURL=retry.d.ts.map