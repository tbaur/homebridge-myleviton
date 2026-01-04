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
/**
 * Default API configuration
 */
exports.DEFAULT_API_CONFIG = {
    baseUrl: 'https://my.leviton.com/api',
    timeout: 10000,
    useCache: true,
    cacheTtl: 2000,
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
        this.rateLimiter = (0, rate_limiter_1.getRateLimiter)();
        this.circuitBreaker = (0, circuit_breaker_1.getCircuitBreaker)();
        this.cache = (0, cache_1.getResponseCache)({ ttlMs: this.config.cacheTtl });
        this.deduplicator = new request_queue_1.RequestDeduplicator();
    }
    /**
     * Make an API request with all protections
     */
    async request(url, options = {}, requestOptions = {}) {
        const { useCache = false, cacheKey = url, bypassCircuitBreaker: _bypassCircuitBreaker = false, debugLog = () => { }, priority: _priority = 'normal', } = requestOptions;
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
     * Execute the actual request
     */
    async executeRequest(url, options, requestOptions) {
        const { useCache = false, cacheKey = url, bypassCircuitBreaker = false, debugLog = () => { }, } = requestOptions;
        const method = options.method || 'GET';
        // Check circuit breaker
        if (!bypassCircuitBreaker && !this.circuitBreaker.canRequest()) {
            const status = this.circuitBreaker.getStatus();
            throw new errors_1.ApiResponseError(503, `Service unavailable (circuit breaker open). Retry in ${Math.ceil((status.remainingResetTime || 30000) / 1000)}s`);
        }
        // Rate limit write operations
        if (method !== 'GET') {
            if (!this.rateLimiter.tryAcquire()) {
                throw new errors_1.ApiResponseError(429, 'Rate limit exceeded');
            }
        }
        // Track half-open request
        if (!bypassCircuitBreaker && this.circuitBreaker.state === circuit_breaker_1.CircuitState.HALF_OPEN) {
            this.circuitBreaker.trackHalfOpenRequest();
        }
        // Create abort controller for timeout
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
            clearTimeout(timeoutId);
            // Get response text
            const responseText = await response.text();
            debugLog(`[API] Response: ${response.status} ${(0, sanitizers_1.createResponsePreview)(responseText, 100)}`);
            // Handle non-OK responses
            if (!response.ok) {
                if (!bypassCircuitBreaker && response.status >= 500) {
                    this.circuitBreaker.recordFailure();
                }
                throw (0, errors_1.createApiError)(response.status, response.statusText, responseText);
            }
            // Check content type
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
                if (!bypassCircuitBreaker) {
                    this.circuitBreaker.recordFailure();
                }
                throw new errors_1.ApiParseError(`Expected JSON response, got ${contentType}`, responseText);
            }
            // Parse JSON
            if (!responseText || responseText.trim().length === 0) {
                throw new errors_1.ApiParseError('Empty response body');
            }
            let data;
            try {
                data = JSON.parse(responseText);
            }
            catch (e) {
                if (!bypassCircuitBreaker) {
                    this.circuitBreaker.recordFailure();
                }
                throw new errors_1.ApiParseError(`Failed to parse JSON: ${e.message}`, responseText);
            }
            // Record success
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
            clearTimeout(timeoutId);
            // Handle abort/timeout
            if (error.name === 'AbortError') {
                if (!bypassCircuitBreaker) {
                    this.circuitBreaker.recordFailure();
                }
                throw new errors_1.TimeoutError(this.config.timeout);
            }
            // Network errors
            if (error instanceof TypeError ||
                error.message?.includes('fetch')) {
                if (!bypassCircuitBreaker) {
                    this.circuitBreaker.recordFailure();
                }
                throw new errors_1.NetworkError(error.message, { cause: error });
            }
            throw error;
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
        debugLog?.(`[login] Authenticating ${validEmail}`);
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
 * Global API client instance
 */
let globalClient = null;
/**
 * Get or create the global API client
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