/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Circuit breaker pattern for API resilience
 */
/**
 * Circuit breaker states
 */
export declare enum CircuitState {
    /** Normal operation - requests flow through */
    CLOSED = "CLOSED",
    /** Circuit tripped - requests fail immediately */
    OPEN = "OPEN",
    /** Testing if service recovered */
    HALF_OPEN = "HALF_OPEN"
}
/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    /** Number of failures before opening circuit */
    failureThreshold: number;
    /** Time in ms before trying half-open */
    resetTimeout: number;
    /** Max requests allowed in half-open state */
    halfOpenMax: number;
    /** Window for counting failures (ms) */
    failureWindow?: number;
}
/**
 * Default circuit breaker configuration
 */
export declare const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig;
/**
 * Circuit breaker status
 */
export interface CircuitBreakerStatus {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number | null;
    halfOpenRequests: number;
    isOpen: boolean;
    remainingResetTime: number | null;
}
/**
 * Circuit breaker implementation for API resilience
 * Prevents cascading failures when the Leviton API is down
 */
export declare class CircuitBreaker {
    private readonly failureThreshold;
    private readonly resetTimeout;
    private readonly halfOpenMax;
    private readonly failureWindow;
    private _state;
    private failures;
    private successes;
    private lastFailureTime;
    private halfOpenRequests;
    private failureTimestamps;
    constructor(config?: Partial<CircuitBreakerConfig>);
    /**
     * Current circuit state
     */
    get state(): CircuitState;
    /**
     * Check if circuit is open
     */
    get isOpen(): boolean;
    /**
     * Clean up old failure timestamps
     */
    private cleanupFailures;
    /**
     * Check if circuit allows requests
     */
    canRequest(): boolean;
    /**
     * Record a successful request
     */
    recordSuccess(): void;
    /**
     * Record a failed request
     */
    recordFailure(): void;
    /**
     * Track half-open request
     */
    trackHalfOpenRequest(): void;
    /**
     * Reset the circuit breaker to closed state
     */
    reset(): void;
    /**
     * Get current circuit breaker status
     */
    getStatus(): CircuitBreakerStatus;
    /**
     * Execute a function with circuit breaker protection
     */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Create a wrapped version of a function with circuit breaker protection
     */
    wrap<T extends unknown[], R>(fn: (...args: T) => Promise<R>): (...args: T) => Promise<R>;
}
/**
 * Get or create the global circuit breaker
 */
export declare function getCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
/**
 * Reset the global circuit breaker (for testing)
 */
export declare function resetGlobalCircuitBreaker(): void;
//# sourceMappingURL=circuit-breaker.d.ts.map