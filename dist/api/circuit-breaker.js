"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Circuit breaker pattern for API resilience
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = exports.DEFAULT_CIRCUIT_BREAKER_CONFIG = exports.CircuitState = void 0;
exports.getCircuitBreaker = getCircuitBreaker;
exports.resetGlobalCircuitBreaker = resetGlobalCircuitBreaker;
const errors_1 = require("../errors");
/**
 * Circuit breaker states
 */
var CircuitState;
(function (CircuitState) {
    /** Normal operation - requests flow through */
    CircuitState["CLOSED"] = "CLOSED";
    /** Circuit tripped - requests fail immediately */
    CircuitState["OPEN"] = "OPEN";
    /** Testing if service recovered */
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (exports.CircuitState = CircuitState = {}));
/**
 * Default circuit breaker configuration
 */
exports.DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenMax: 3,
    failureWindow: 60000,
};
/**
 * Circuit breaker implementation for API resilience
 * Prevents cascading failures when the Leviton API is down
 */
class CircuitBreaker {
    failureThreshold;
    resetTimeout;
    halfOpenMax;
    failureWindow;
    _state = CircuitState.CLOSED;
    failures = 0;
    successes = 0;
    lastFailureTime = null;
    halfOpenRequests = 0;
    failureTimestamps = [];
    constructor(config = {}) {
        const merged = { ...exports.DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
        this.failureThreshold = merged.failureThreshold;
        this.resetTimeout = merged.resetTimeout;
        this.halfOpenMax = merged.halfOpenMax;
        this.failureWindow = merged.failureWindow ?? 60000;
    }
    /**
     * Current circuit state
     */
    get state() {
        return this._state;
    }
    /**
     * Check if circuit is open
     */
    get isOpen() {
        return this._state === CircuitState.OPEN;
    }
    /**
     * Clean up old failure timestamps
     */
    cleanupFailures() {
        const cutoff = Date.now() - this.failureWindow;
        this.failureTimestamps = this.failureTimestamps.filter(ts => ts > cutoff);
        this.failures = this.failureTimestamps.length;
    }
    /**
     * Check if circuit allows requests
     */
    canRequest() {
        if (this._state === CircuitState.CLOSED) {
            return true;
        }
        if (this._state === CircuitState.OPEN) {
            // Check if enough time has passed to try again
            if (this.lastFailureTime && (Date.now() - this.lastFailureTime) >= this.resetTimeout) {
                this._state = CircuitState.HALF_OPEN;
                this.halfOpenRequests = 0;
                this.successes = 0;
                return true;
            }
            return false;
        }
        if (this._state === CircuitState.HALF_OPEN) {
            // Allow limited requests in half-open state
            return this.halfOpenRequests < this.halfOpenMax;
        }
        return false;
    }
    /**
     * Record a successful request
     */
    recordSuccess() {
        if (this._state === CircuitState.HALF_OPEN) {
            this.successes++;
            // After enough successes in half-open, close the circuit
            if (this.successes >= this.halfOpenMax) {
                this.reset();
            }
        }
        else if (this._state === CircuitState.CLOSED) {
            // Gradually reduce failure count on success
            this.cleanupFailures();
        }
    }
    /**
     * Record a failed request
     */
    recordFailure() {
        const now = Date.now();
        this.lastFailureTime = now;
        this.failureTimestamps.push(now);
        if (this._state === CircuitState.HALF_OPEN) {
            // Any failure in half-open state opens the circuit again
            this._state = CircuitState.OPEN;
            this.halfOpenRequests = 0;
            this.successes = 0;
        }
        else if (this._state === CircuitState.CLOSED) {
            this.cleanupFailures();
            if (this.failures >= this.failureThreshold) {
                this._state = CircuitState.OPEN;
            }
        }
    }
    /**
     * Track half-open request
     */
    trackHalfOpenRequest() {
        if (this._state === CircuitState.HALF_OPEN) {
            this.halfOpenRequests++;
        }
    }
    /**
     * Reset the circuit breaker to closed state
     */
    reset() {
        this._state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.halfOpenRequests = 0;
        this.failureTimestamps = [];
    }
    /**
     * Get current circuit breaker status
     */
    getStatus() {
        const now = Date.now();
        let remainingResetTime = null;
        if (this._state === CircuitState.OPEN && this.lastFailureTime) {
            remainingResetTime = Math.max(0, this.resetTimeout - (now - this.lastFailureTime));
        }
        return {
            state: this._state,
            failures: this.failures,
            successes: this.successes,
            lastFailureTime: this.lastFailureTime,
            halfOpenRequests: this.halfOpenRequests,
            isOpen: this.isOpen,
            remainingResetTime,
        };
    }
    /**
     * Execute a function with circuit breaker protection
     */
    async execute(fn) {
        if (!this.canRequest()) {
            const status = this.getStatus();
            throw new errors_1.CircuitBreakerError(status.remainingResetTime ?? this.resetTimeout);
        }
        if (this._state === CircuitState.HALF_OPEN) {
            this.trackHalfOpenRequest();
        }
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    /**
     * Create a wrapped version of a function with circuit breaker protection
     */
    wrap(fn) {
        return (...args) => this.execute(() => fn(...args));
    }
}
exports.CircuitBreaker = CircuitBreaker;
/**
 * Global circuit breaker instance
 */
let globalCircuitBreaker = null;
/**
 * Get or create the global circuit breaker
 */
function getCircuitBreaker(config) {
    if (!globalCircuitBreaker) {
        globalCircuitBreaker = new CircuitBreaker(config);
    }
    return globalCircuitBreaker;
}
/**
 * Reset the global circuit breaker (for testing)
 */
function resetGlobalCircuitBreaker() {
    globalCircuitBreaker = null;
}
//# sourceMappingURL=circuit-breaker.js.map