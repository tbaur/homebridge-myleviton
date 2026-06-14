/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Leviton API HTTP client
 */

import {
  AuthenticationError,
  NetworkError,
  TimeoutError,
  ApiParseError,
  ApiResponseError,
  createApiError,
  ValidationError,
} from '../errors'
import { RateLimiter } from './rate-limiter'
import { CircuitBreaker, CircuitState } from './circuit-breaker'
import { ResponseCache } from './cache'
import { RequestDeduplicator } from './request-queue'
import { validateEmail, validatePassword, validateDeviceId, validateToken, validateBrightness, validatePowerState } from '../utils/validators'
import { maskToken, createResponsePreview } from '../utils/sanitizers'
import { withRetry } from '../utils/retry'
import type { 
  DeviceInfo, 
  DeviceStatus, 
  LoginResponse, 
  ResidentialPermission, 
  ResidentialAccount, 
  Residence,
  PowerState,
  ApiRequestOptions,
} from '../types'

/**
 * Minimal logger surface used by the client for resilience observability.
 * Optional methods so a partial logger (or none) can be supplied.
 */
export interface ClientLogger {
  debug?: (message: string) => void
  info?: (message: string) => void
  warn?: (message: string) => void
}

/**
 * A single request measurement reported to the optional `metrics` hook.
 */
export interface RequestMetric {
  /** Wall-clock duration of the logical request in milliseconds. */
  durationMs: number
  /** Whether the request ultimately succeeded. */
  ok: boolean
}

/**
 * API configuration
 */
export interface ApiClientConfig {
  /** Base URL for Leviton API */
  baseUrl: string
  /** Request timeout in ms */
  timeout: number
  /** Whether to use response caching */
  useCache: boolean
  /** Cache TTL in ms */
  cacheTtl: number
  /** Maximum attempts for transient (network/5xx) failures before giving up */
  maxRetryAttempts: number
  /** Optional logger for resilience events (circuit breaker, rate limiting) */
  logger?: ClientLogger
  /**
   * Optional metrics hook fired around EVERY logical request, including
   * timeouts, network errors, circuit-breaker rejections, and rate-limit
   * rejections. Cache hits are not reported (no request is made).
   */
  metrics?: (sample: RequestMetric) => void
}

/**
 * Default API configuration
 */
export const DEFAULT_API_CONFIG: ApiClientConfig = {
  baseUrl: 'https://my.leviton.com/api',
  timeout: 10000,
  useCache: true,
  cacheTtl: 2000,
  maxRetryAttempts: 3,
}

/**
 * Default headers for API requests
 */
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
}

/**
 * Convert object to URL query string
 */
function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

/**
 * Transient errors worth retrying: network/timeouts and 5xx responses.
 * Auth (401/403), not-found (404), and rate-limit (429) errors are excluded so
 * they surface immediately to the caller.
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true // includes TimeoutError
  }
  if (error instanceof ApiResponseError) {
    return error.httpStatus >= 500 && error.httpStatus < 600
  }
  return false
}

/**
 * Errors that should count against the circuit breaker: server-side and
 * connectivity problems. Client errors (4xx) reflect the request, not service
 * health, and must not trip the breaker.
 */
function isCircuitBreakerFailure(error: unknown): boolean {
  if (error instanceof NetworkError || error instanceof ApiParseError) {
    return true
  }
  if (error instanceof ApiResponseError) {
    return error.httpStatus >= 500 && error.httpStatus < 600
  }
  return false
}

/**
 * Leviton API client
 */
export class LevitonApiClient {
  private readonly config: ApiClientConfig
  private readonly rateLimiter: RateLimiter
  private readonly circuitBreaker: CircuitBreaker
  private readonly cache: ResponseCache
  private readonly deduplicator: RequestDeduplicator

  constructor(config: Partial<ApiClientConfig> = {}) {
    this.config = { ...DEFAULT_API_CONFIG, ...config }
    // Each client owns its resilience state so independent platform instances
    // (e.g. multiple Leviton accounts) don't share a circuit breaker, rate
    // limiter, or cache and trip each other.
    this.rateLimiter = new RateLimiter()
    this.circuitBreaker = new CircuitBreaker({
      onStateChange: (from, to) => this.logCircuitTransition(from, to),
    })
    this.cache = new ResponseCache({ ttlMs: this.config.cacheTtl })
    this.deduplicator = new RequestDeduplicator()
  }

  /**
   * Surface circuit-breaker transitions so operators can see when the Leviton
   * API is being treated as unavailable and when it recovers.
   */
  private logCircuitTransition(from: CircuitState, to: CircuitState): void {
    const message = `Circuit breaker ${from} -> ${to}`
    if (to === CircuitState.OPEN) {
      this.config.logger?.warn?.(message)
    } else {
      this.config.logger?.info?.(message)
    }
  }

  /**
   * Make an API request with all protections
   */
  private async request<T>(
    url: string,
    options: RequestInit = {},
    requestOptions: ApiRequestOptions = {},
  ): Promise<T> {
    const {
      useCache = false,
      cacheKey = url,
       
      bypassCircuitBreaker: _bypassCircuitBreaker = false,
      debugLog = () => {},
       
      priority: _priority = 'normal',
    } = requestOptions

    const method = options.method || 'GET'
    const dedupeKey = `${method}:${url}`

    debugLog(`[API] ${method} ${url}`)

    // Check cache first
    if (useCache && method === 'GET') {
      const cached = this.cache.get(cacheKey)
      if (cached !== null) {
        debugLog(`[API] Cache hit: ${cacheKey}`)
        return cached as T
      }
    }

    // Deduplicate concurrent requests for same resource
    if (useCache && method === 'GET') {
      return this.deduplicator.execute(dedupeKey, () =>
        this.executeRequest<T>(url, options, requestOptions),
      )
    }

    return this.executeRequest<T>(url, options, requestOptions)
  }

  /**
   * Execute the actual request, reporting a metrics sample around the full
   * logical request (including breaker/rate-limit rejections, timeouts, and
   * errors) when a `metrics` hook is configured.
   */
  private async executeRequest<T>(
    url: string,
    options: RequestInit,
    requestOptions: ApiRequestOptions,
  ): Promise<T> {
    if (!this.config.metrics) {
      return this.runRequest<T>(url, options, requestOptions)
    }

    const startTime = Date.now()
    let ok = false
    try {
      const result = await this.runRequest<T>(url, options, requestOptions)
      ok = true
      return result
    } finally {
      this.config.metrics({ durationMs: Date.now() - startTime, ok })
    }
  }

  /**
   * Run a single logical request with circuit breaker, rate limiting, retry,
   * and caching protections.
   */
  private async runRequest<T>(
    url: string,
    options: RequestInit,
    requestOptions: ApiRequestOptions,
  ): Promise<T> {
    const {
      useCache = false,
      cacheKey = url,
      bypassCircuitBreaker = false,
      debugLog = () => {},
    } = requestOptions

    const method = options.method || 'GET'

    // Check circuit breaker (gated once per logical request, never retried)
    if (!bypassCircuitBreaker && !this.circuitBreaker.canRequest()) {
      const status = this.circuitBreaker.getStatus()
      throw new ApiResponseError(
        503,
        `Service unavailable (circuit breaker open). Retry in ${Math.ceil((status.remainingResetTime || 30000) / 1000)}s`,
      )
    }

    // Rate limit write operations (counted once per logical request, not per retry)
    if (method !== 'GET') {
      if (!this.rateLimiter.tryAcquire()) {
        this.config.logger?.warn?.(`Rate limit exceeded for ${method} ${url}`)
        throw new ApiResponseError(429, 'Rate limit exceeded')
      }
    }

    // Track half-open request
    if (!bypassCircuitBreaker && this.circuitBreaker.state === CircuitState.HALF_OPEN) {
      this.circuitBreaker.trackHalfOpenRequest()
    }

    try {
      // Retry only transient failures (network, timeout, 5xx). Auth (401/403)
      // and rate-limit (429) errors are surfaced immediately so the platform's
      // token-refresh path and the caller can react without blocking here.
      const data = await withRetry<T>(
        () => this.fetchAndParse<T>(url, options, debugLog),
        {
          maxAttempts: Math.max(1, this.config.maxRetryAttempts),
          baseDelay: 500,
          maxDelay: 5000,
          backoffMultiplier: 2,
          shouldRetry: isTransientError,
          onRetry: (attempt, error) =>
            debugLog(`[API] Retry ${attempt} after transient error: ${error.message}`),
        },
      )

      if (!bypassCircuitBreaker) {
        this.circuitBreaker.recordSuccess()
      }

      // Cache response
      if (useCache && method === 'GET') {
        this.cache.set(cacheKey, data)
      }

      return data
    } catch (error) {
      // A single failure is recorded per logical request after retries are
      // exhausted, so retries don't artificially accelerate the breaker.
      if (!bypassCircuitBreaker && isCircuitBreakerFailure(error)) {
        this.circuitBreaker.recordFailure()
      }
      throw error
    }
  }

  /**
   * Performs a single fetch + parse cycle, translating low-level failures into
   * typed errors. Intentionally free of circuit-breaker, rate-limit, and cache
   * side effects so it can be safely retried.
   */
  private async fetchAndParse<T>(
    url: string,
    options: RequestInit,
    debugLog: (msg: string) => void,
  ): Promise<T> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...DEFAULT_HEADERS,
          ...options.headers,
        },
      })

      const responseText = await response.text()
      debugLog(`[API] Response: ${response.status} ${createResponsePreview(responseText, 100)}`)

      if (!response.ok) {
        throw createApiError(response.status, response.statusText, responseText)
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
        throw new ApiParseError(`Expected JSON response, got ${contentType}`, responseText)
      }

      if (!responseText || responseText.trim().length === 0) {
        throw new ApiParseError('Empty response body')
      }

      try {
        return JSON.parse(responseText) as T
      } catch (e) {
        throw new ApiParseError(`Failed to parse JSON: ${(e as Error).message}`, responseText)
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new TimeoutError(this.config.timeout)
      }

      if (error instanceof TypeError || (error as Error).message?.includes('fetch')) {
        throw new NetworkError((error as Error).message, { cause: error as Error })
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Login and get authentication token
   */
  async login(email: string, password: string, debugLog?: (msg: string) => void): Promise<LoginResponse> {
    const validEmail = validateEmail(email)
    const validPassword = validatePassword(password)

    const query = toQueryString({ include: 'user' })
    const url = `${this.config.baseUrl}/Person/login?${query}`

    debugLog?.(`[login] Authenticating ${validEmail}`)

    const response = await this.request<LoginResponse>(
      url,
      {
        method: 'POST',
        body: JSON.stringify({ email: validEmail, password: validPassword }),
      },
      {
        bypassCircuitBreaker: true, // Login bypasses circuit breaker
        debugLog,
      },
    )

    if (!response.id || !response.userId) {
      throw new AuthenticationError('Invalid login response: missing token or userId')
    }

    debugLog?.(`[login] Success, token: ${maskToken(response.id)}`)
    return response
  }

  /**
   * Get residential permissions for a person
   */
  async getResidentialPermissions(
    personId: string,
    token: string,
    debugLog?: (msg: string) => void,
  ): Promise<ResidentialPermission[]> {
    const validPersonId = validateDeviceId(personId)
    const validToken = validateToken(token)

    const url = `${this.config.baseUrl}/Person/${validPersonId}/residentialPermissions`

    return this.request<ResidentialPermission[]>(
      url,
      {
        method: 'GET',
        headers: { Authorization: validToken },
      },
      { debugLog },
    )
  }

  /**
   * Get residential account details
   */
  async getResidentialAccount(
    accountId: string,
    token: string,
    debugLog?: (msg: string) => void,
  ): Promise<ResidentialAccount> {
    const validAccountId = validateDeviceId(accountId)
    const validToken = validateToken(token)

    const url = `${this.config.baseUrl}/ResidentialAccounts/${validAccountId}`

    return this.request<ResidentialAccount>(
      url,
      {
        method: 'GET',
        headers: { Authorization: validToken },
      },
      { debugLog },
    )
  }

  /**
   * Get residences using v2 API
   */
  async getResidences(
    residenceObjectId: string,
    token: string,
    debugLog?: (msg: string) => void,
  ): Promise<Residence[]> {
    const validId = validateDeviceId(residenceObjectId)
    const validToken = validateToken(token)

    const url = `${this.config.baseUrl}/ResidentialAccounts/${validId}/residences`

    return this.request<Residence[]>(
      url,
      {
        method: 'GET',
        headers: { Authorization: validToken },
      },
      { debugLog },
    )
  }

  /**
   * Get IoT switches for a residence
   */
  async getDevices(
    residenceId: string,
    token: string,
    debugLog?: (msg: string) => void,
  ): Promise<DeviceInfo[]> {
    const validResidenceId = validateDeviceId(residenceId)
    const validToken = validateToken(token)

    const url = `${this.config.baseUrl}/Residences/${validResidenceId}/iotSwitches`

    return this.request<DeviceInfo[]>(
      url,
      {
        method: 'GET',
        headers: { Authorization: validToken },
      },
      { debugLog },
    )
  }

  /**
   * Get status of a specific device
   */
  async getDeviceStatus(
    deviceId: string,
    token: string,
    debugLog?: (msg: string) => void,
  ): Promise<DeviceStatus> {
    const validDeviceId = validateDeviceId(deviceId)
    const validToken = validateToken(token)

    const url = `${this.config.baseUrl}/IotSwitches/${validDeviceId}`
    const cacheKey = `device:${validDeviceId}`

    return this.request<DeviceStatus>(
      url,
      {
        method: 'GET',
        headers: { Authorization: validToken },
      },
      {
        useCache: true,
        cacheKey,
        debugLog,
      },
    )
  }

  /**
   * Update device state
   */
  async setDeviceState(
    deviceId: string,
    token: string,
    state: { power?: PowerState; brightness?: number },
    debugLog?: (msg: string) => void,
  ): Promise<DeviceStatus> {
    const validDeviceId = validateDeviceId(deviceId)
    const validToken = validateToken(token)

    // Validate state
    const body: Record<string, unknown> = {}

    if (state.power !== undefined) {
      body.power = validatePowerState(state.power)
    }

    if (state.brightness !== undefined) {
      body.brightness = validateBrightness(state.brightness)
    }

    if (Object.keys(body).length === 0) {
      throw new ValidationError('state', 'At least one of power or brightness must be provided')
    }

    const url = `${this.config.baseUrl}/IotSwitches/${validDeviceId}`
    const cacheKey = `device:${validDeviceId}`

    const result = await this.request<DeviceStatus>(
      url,
      {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { Authorization: validToken },
      },
      { debugLog },
    )

    // Invalidate cache after successful update
    this.cache.delete(cacheKey)

    return result
  }

  /**
   * Set device power
   */
  async setPower(
    deviceId: string,
    token: string,
    power: boolean,
    debugLog?: (msg: string) => void,
  ): Promise<DeviceStatus> {
    return this.setDeviceState(deviceId, token, { power: power ? 'ON' : 'OFF' }, debugLog)
  }

  /**
   * Set device brightness
   */
  async setBrightness(
    deviceId: string,
    token: string,
    brightness: number,
    debugLog?: (msg: string) => void,
  ): Promise<DeviceStatus> {
    return this.setDeviceState(deviceId, token, { brightness }, debugLog)
  }

  /**
   * Clear response cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Invalidate cache for a specific device
   */
  invalidateDeviceCache(deviceId: string): void {
    this.cache.delete(`device:${deviceId}`)
  }

  /**
   * Get client status
   */
  getStatus(): {
    circuitBreaker: ReturnType<CircuitBreaker['getStatus']>
    rateLimiter: ReturnType<RateLimiter['getStatus']>
    cache: ReturnType<ResponseCache['getStats']>
  } {
    return {
      circuitBreaker: this.circuitBreaker.getStatus(),
      rateLimiter: this.rateLimiter.getStatus(),
      cache: this.cache.getStats(),
    }
  }

  /**
   * Reset all client state (for testing)
   */
  reset(): void {
    this.cache.clear()
    this.circuitBreaker.reset()
    this.rateLimiter.reset()
    this.deduplicator.clear()
  }
}

/**
 * Global API client instance
 */
let globalClient: LevitonApiClient | null = null

/**
 * Get or create the global API client
 */
export function getApiClient(config?: Partial<ApiClientConfig>): LevitonApiClient {
  if (!globalClient) {
    globalClient = new LevitonApiClient(config)
  }
  return globalClient
}

/**
 * Reset the global client (for testing)
 */
export function resetGlobalClient(): void {
  globalClient?.reset()
  globalClient = null
}

