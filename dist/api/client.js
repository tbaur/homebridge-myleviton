"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Leviton API HTTP client
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LevitonApiClient = exports.DEFAULT_API_CONFIG = void 0;
exports.getApiClient = getApiClient;
exports.resetGlobalClient = resetGlobalClient;
const errors_1 = require("../errors");
const rate_limiter_1 = require("./rate-limiter");
const circuit_breaker_1 = require("./circuit-breaker");
const cache_1 = require("./cache");
const request_queue_1 = require("./request-queue");
const validators_1 = require("../utils/validators");
const sanitizers_1 = require("../utils/sanitizers");
const retry_1 = require("../utils/retry");
/**
 * Default API configuration
 */
exports.DEFAULT_API_CONFIG = {
    baseUrl: 'https://my.leviton.com/api',
    timeout: 10000,
    useCache: true,
    cacheTtl: 2000,
    maxRetryAttempts: 3,
};
/**
 * Default headers for API requests
 */
const DEFAULT_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
};
/**
 * Convert object to URL query string
 */
function toQueryString(params) {
    return Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
}
/**
 * Transient errors worth retrying: network/timeouts and 5xx responses.
 * Auth (401/403), not-found (404), and rate-limit (429) errors are excluded so
 * they surface immediately to the caller.
 */
function isTransientError(error) {
    if (error instanceof errors_1.NetworkError) {
        return true; // includes TimeoutError
    }
    if (error instanceof errors_1.ApiResponseError) {
        return error.httpStatus >= 500 && error.httpStatus < 600;
    }
    return false;
}
/**
 * Errors that should count against the circuit breaker: server-side and
 * connectivity problems. Client errors (4xx) reflect the request, not service
 * health, and must not trip the breaker.
 */
function isCircuitBreakerFailure(error) {
    if (error instanceof errors_1.NetworkError || error instanceof errors_1.ApiParseError) {
        return true;
    }
    if (error instanceof errors_1.ApiResponseError) {
        return error.httpStatus >= 500 && error.httpStatus < 600;
    }
    return false;
}
/**
 * Leviton API client
 */
class LevitonApiClient {
    config;
    rateLimiter;
    circuitBreaker;
    cache;
    deduplicator;
    constructor(config = {}) {
        this.config = { ...exports.DEFAULT_API_CONFIG, ...config };
        // Each client owns its resilience state so independent platform instances
        // (e.g. multiple Leviton accounts) don't share a circuit breaker, rate
        // limiter, or cache and trip each other.
        this.rateLimiter = new rate_limiter_1.RateLimiter();
        this.circuitBreaker = new circuit_breaker_1.CircuitBreaker({
            onStateChange: (from, to) => this.logCircuitTransition(from, to),
        });
        this.cache = new cache_1.ResponseCache({ ttlMs: this.config.cacheTtl });
        this.deduplicator = new request_queue_1.RequestDeduplicator();
    }
    /**
     * Surface circuit-breaker transitions so operators can see when the Leviton
     * API is being treated as unavailable and when it recovers.
     */
    logCircuitTransition(from, to) {
        const message = `Circuit breaker ${from} -> ${to}`;
        if (to === circuit_breaker_1.CircuitState.OPEN) {
            this.config.logger?.warn?.(message);
            this.config.onCircuitOpen?.();
        }
        else {
            this.config.logger?.info?.(message);
        }
    }
    /**
     * Make an API request with all protections
     */
    async request(url, options = {}, requestOptions = {}) {
        const { useCache = false, cacheKey = url, bypassCircuitBreaker: _bypassCircuitBreaker = false, debugLog = () => { }, } = requestOptions;
        const method = options.method || 'GET';
        const dedupeKey = `${method}:${url}`;
        debugLog(`[API] ${method} ${url}`);
        // Check cache first
        if (useCache && method === 'GET') {
            const cached = this.cache.get(cacheKey);
            if (cached !== null) {
                debugLog(`[API] Cache hit: ${cacheKey}`);
                return cached;
            }
        }
        // Deduplicate concurrent requests for same resource
        if (useCache && method === 'GET') {
            return this.deduplicator.execute(dedupeKey, () => this.executeRequest(url, options, requestOptions));
        }
        return this.executeRequest(url, options, requestOptions);
    }
    /**
     * Execute the actual request, reporting a metrics sample around the full
     * logical request (including breaker/rate-limit rejections, timeouts, and
     * errors) when a `metrics` hook is configured.
     */
    async executeRequest(url, options, requestOptions) {
        if (!this.config.metrics) {
            return this.runRequest(url, options, requestOptions);
        }
        const startTime = Date.now();
        let ok = false;
        let networked = false;
        try {
            const result = await this.runRequest(url, options, requestOptions, () => {
                networked = true;
            });
            ok = true;
            return result;
        }
        finally {
            this.config.metrics({ durationMs: Date.now() - startTime, ok, networked });
        }
    }
    /**
     * Run a single logical request with circuit breaker, rate limiting, retry,
     * and caching protections. `markNetworked` is invoked once the request clears
     * the pre-flight gates and is about to hit the network.
     */
    async runRequest(url, options, requestOptions, markNetworked = () => { }) {
        const { useCache = false, cacheKey = url, bypassCircuitBreaker = false, debugLog = () => { }, } = requestOptions;
        const method = options.method || 'GET';
        // Check circuit breaker (gated once per logical request, never retried)
        if (!bypassCircuitBreaker && !this.circuitBreaker.canRequest()) {
            const status = this.circuitBreaker.getStatus();
            throw new errors_1.ApiResponseError(503, `Service unavailable (circuit breaker open). Retry in ${Math.ceil((status.remainingResetTime || 30000) / 1000)}s`);
        }
        // Rate limit write operations (counted once per logical request, not per retry)
        if (method !== 'GET') {
            if (!this.rateLimiter.tryAcquire()) {
                this.config.logger?.warn?.(`Rate limit exceeded for ${method} ${url}`);
                throw new errors_1.ApiResponseError(429, 'Rate limit exceeded');
            }
        }
        // Track half-open request
        if (!bypassCircuitBreaker && this.circuitBreaker.state === circuit_breaker_1.CircuitState.HALF_OPEN) {
            this.circuitBreaker.trackHalfOpenRequest();
        }
        // Pre-flight gates cleared; a network fetch is about to be attempted.
        markNetworked();
        try {
            // Retry only transient failures (network, timeout, 5xx). Auth (401/403)
            // and rate-limit (429) errors are surfaced immediately so the platform's
            // token-refresh path and the caller can react without blocking here.
            const data = await (0, retry_1.withRetry)(() => this.fetchAndParse(url, options, debugLog), {
                maxAttempts: Math.max(1, this.config.maxRetryAttempts),
                baseDelay: 500,
                maxDelay: 5000,
                backoffMultiplier: 2,
                shouldRetry: isTransientError,
                onRetry: (attempt, error) => debugLog(`[API] Retry ${attempt} after transient error: ${error.message}`),
            });
            if (!bypassCircuitBreaker) {
                this.circuitBreaker.recordSuccess();
            }
            // Cache response
            if (useCache && method === 'GET') {
                this.cache.set(cacheKey, data);
            }
            return data;
        }
        catch (error) {
            // A single failure is recorded per logical request after retries are
            // exhausted, so retries don't artificially accelerate the breaker.
            if (!bypassCircuitBreaker && isCircuitBreakerFailure(error)) {
                this.circuitBreaker.recordFailure();
            }
            throw error;
        }
    }
    /**
     * Performs a single fetch + parse cycle, translating low-level failures into
     * typed errors. Intentionally free of circuit-breaker, rate-limit, and cache
     * side effects so it can be safely retried.
     */
    async fetchAndParse(url, options, debugLog) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    ...DEFAULT_HEADERS,
                    ...options.headers,
                },
            });
            const responseText = await response.text();
            debugLog(`[API] Response: ${response.status} ${(0, sanitizers_1.createResponsePreview)(responseText, 100)}`);
            if (!response.ok) {
                throw (0, errors_1.createApiError)(response.status, response.statusText, responseText);
            }
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
                throw new errors_1.ApiParseError(`Expected JSON response, got ${contentType}`, responseText);
            }
            if (!responseText || responseText.trim().length === 0) {
                throw new errors_1.ApiParseError('Empty response body');
            }
            try {
                return JSON.parse(responseText);
            }
            catch (e) {
                throw new errors_1.ApiParseError(`Failed to parse JSON: ${e.message}`, responseText);
            }
        }
        catch (error) {
            if (error.name === 'AbortError') {
                throw new errors_1.TimeoutError(this.config.timeout);
            }
            if (error instanceof TypeError || error.message?.includes('fetch')) {
                throw new errors_1.NetworkError(error.message, { cause: error });
            }
            throw error;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    /**
     * Login and get authentication token
     */
    async login(email, password, debugLog) {
        const validEmail = (0, validators_1.validateEmail)(email);
        const validPassword = (0, validators_1.validatePassword)(password);
        const query = toQueryString({ include: 'user' });
        const url = `${this.config.baseUrl}/Person/login?${query}`;
        debugLog?.('[login] Authenticating user');
        const response = await this.request(url, {
            method: 'POST',
            body: JSON.stringify({ email: validEmail, password: validPassword }),
        }, {
            bypassCircuitBreaker: true, // Login bypasses circuit breaker
            debugLog,
        });
        if (!response.id || !response.userId) {
            throw new errors_1.AuthenticationError('Invalid login response: missing token or userId');
        }
        debugLog?.(`[login] Success, token: ${(0, sanitizers_1.maskToken)(response.id)}`);
        return response;
    }
    /**
     * Get residential permissions for a person
     */
    async getResidentialPermissions(personId, token, debugLog) {
        const validPersonId = (0, validators_1.validateDeviceId)(personId);
        const validToken = (0, validators_1.validateToken)(token);
        const url = `${this.config.baseUrl}/Person/${validPersonId}/residentialPermissions`;
        return this.request(url, {
            method: 'GET',
            headers: { Authorization: validToken },
        }, { debugLog });
    }
    /**
     * Get residential account details
     */
    async getResidentialAccount(accountId, token, debugLog) {
        const validAccountId = (0, validators_1.validateDeviceId)(accountId);
        const validToken = (0, validators_1.validateToken)(token);
        const url = `${this.config.baseUrl}/ResidentialAccounts/${validAccountId}`;
        return this.request(url, {
            method: 'GET',
            headers: { Authorization: validToken },
        }, { debugLog });
    }
    /**
     * Get residences using v2 API
     */
    async getResidences(residenceObjectId, token, debugLog) {
        const validId = (0, validators_1.validateDeviceId)(residenceObjectId);
        const validToken = (0, validators_1.validateToken)(token);
        const url = `${this.config.baseUrl}/ResidentialAccounts/${validId}/residences`;
        return this.request(url, {
            method: 'GET',
            headers: { Authorization: validToken },
        }, { debugLog });
    }
    /**
     * Get IoT switches for a residence
     */
    async getDevices(residenceId, token, debugLog) {
        const validResidenceId = (0, validators_1.validateDeviceId)(residenceId);
        const validToken = (0, validators_1.validateToken)(token);
        const url = `${this.config.baseUrl}/Residences/${validResidenceId}/iotSwitches`;
        return this.request(url, {
            method: 'GET',
            headers: { Authorization: validToken },
        }, { debugLog });
    }
    /**
     * Get status of a specific device
     */
    async getDeviceStatus(deviceId, token, debugLog) {
        const validDeviceId = (0, validators_1.validateDeviceId)(deviceId);
        const validToken = (0, validators_1.validateToken)(token);
        const url = `${this.config.baseUrl}/IotSwitches/${validDeviceId}`;
        const cacheKey = `device:${validDeviceId}`;
        return this.request(url, {
            method: 'GET',
            headers: { Authorization: validToken },
        }, {
            useCache: true,
            cacheKey,
            debugLog,
        });
    }
    /**
     * Update device state
     */
    async setDeviceState(deviceId, token, state, debugLog) {
        const validDeviceId = (0, validators_1.validateDeviceId)(deviceId);
        const validToken = (0, validators_1.validateToken)(token);
        // Validate state
        const body = {};
        if (state.power !== undefined) {
            body.power = (0, validators_1.validatePowerState)(state.power);
        }
        if (state.brightness !== undefined) {
            body.brightness = (0, validators_1.validateBrightness)(state.brightness);
        }
        if (Object.keys(body).length === 0) {
            throw new errors_1.ValidationError('state', 'At least one of power or brightness must be provided');
        }
        const url = `${this.config.baseUrl}/IotSwitches/${validDeviceId}`;
        const cacheKey = `device:${validDeviceId}`;
        const result = await this.request(url, {
            method: 'PUT',
            body: JSON.stringify(body),
            headers: { Authorization: validToken },
        }, { debugLog });
        // Invalidate cache after successful update
        this.cache.delete(cacheKey);
        return result;
    }
    /**
     * Set device power
     */
    async setPower(deviceId, token, power, debugLog) {
        return this.setDeviceState(deviceId, token, { power: power ? 'ON' : 'OFF' }, debugLog);
    }
    /**
     * Set device brightness
     */
    async setBrightness(deviceId, token, brightness, debugLog) {
        return this.setDeviceState(deviceId, token, { brightness }, debugLog);
    }
    /**
     * Clear response cache
     */
    clearCache() {
        this.cache.clear();
    }
    /**
     * Invalidate cache for a specific device
     */
    invalidateDeviceCache(deviceId) {
        this.cache.delete(`device:${deviceId}`);
    }
    /**
     * Get client status
     */
    getStatus() {
        return {
            circuitBreaker: this.circuitBreaker.getStatus(),
            rateLimiter: this.rateLimiter.getStatus(),
            cache: this.cache.getStats(),
        };
    }
    /**
     * Reset all client state (for testing)
     */
    reset() {
        this.cache.clear();
        this.circuitBreaker.reset();
        this.rateLimiter.reset();
        this.deduplicator.clear();
    }
}
exports.LevitonApiClient = LevitonApiClient;
/**
 * Global API client instance (test helper — production code creates per-platform clients).
 * @deprecated Prefer `new LevitonApiClient()` per platform instance.
 */
let globalClient = null;
/**
 * Get or create the global API client
 * @deprecated Prefer constructing LevitonApiClient per platform instance.
 */
function getApiClient(config) {
    if (!globalClient) {
        globalClient = new LevitonApiClient(config);
    }
    return globalClient;
}
/**
 * Reset the global client (for testing)
 */
function resetGlobalClient() {
    globalClient?.reset();
    globalClient = null;
}
//# sourceMappingURL=client.js.map