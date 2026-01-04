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
import { RateLimiter, getRateLimiter } from './rate-limiter'
import { CircuitBreaker, getCircuitBreaker, CircuitState } from './circuit-breaker'
import { ResponseCache, getResponseCache } from './cache'
import { RequestDeduplicator } from './request-queue'
import { validateEmail, validatePassword, validateDeviceId, validateToken, validateBrightness, validatePowerState } from '../utils/validators'
import { maskToken, createResponsePreview } from '../utils/sanitizers'
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
}

/**
 * Default API configuration
 */
export const DEFAULT_API_CONFIG: ApiClientConfig = {
  baseUrl: 'https://my.leviton.com/api',
  timeout: 10000,
  useCache: true,
  cacheTtl: 2000,
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
    this.rateLimiter = getRateLimiter()
    this.circuitBreaker = getCircuitBreaker()
    this.cache = getResponseCache({ ttlMs: this.config.cacheTtl })
    this.deduplicator = new RequestDeduplicator()
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
   * Execute the actual request
   */
  private async executeRequest<T>(
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

    // Check circuit breaker
    if (!bypassCircuitBreaker && !this.circuitBreaker.canRequest()) {
      const status = this.circuitBreaker.getStatus()
      throw new ApiResponseError(
        503,
        `Service unavailable (circuit breaker open). Retry in ${Math.ceil((status.remainingResetTime || 30000) / 1000)}s`,
      )
    }

    // Rate limit write operations
    if (method !== 'GET') {
      if (!this.rateLimiter.tryAcquire()) {
        throw new ApiResponseError(429, 'Rate limit exceeded')
      }
    }

    // Track half-open request
    if (!bypassCircuitBreaker && this.circuitBreaker.state === CircuitState.HALF_OPEN) {
      this.circuitBreaker.trackHalfOpenRequest()
    }

    // Create abort controller for timeout
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

      clearTimeout(timeoutId)

      // Get response text
      const responseText = await response.text()
      debugLog(`[API] Response: ${response.status} ${createResponsePreview(responseText, 100)}`)

      // Handle non-OK responses
      if (!response.ok) {
        if (!bypassCircuitBreaker && response.status >= 500) {
          this.circuitBreaker.recordFailure()
        }
        throw createApiError(response.status, response.statusText, responseText)
      }

      // Check content type
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
        if (!bypassCircuitBreaker) {
          this.circuitBreaker.recordFailure()
        }
        throw new ApiParseError(
          `Expected JSON response, got ${contentType}`,
          responseText,
        )
      }

      // Parse JSON
      if (!responseText || responseText.trim().length === 0) {
        throw new ApiParseError('Empty response body')
      }

      let data: T
      try {
        data = JSON.parse(responseText) as T
      } catch (e) {
        if (!bypassCircuitBreaker) {
          this.circuitBreaker.recordFailure()
        }
        throw new ApiParseError(
          `Failed to parse JSON: ${(e as Error).message}`,
          responseText,
        )
      }

      // Record success
      if (!bypassCircuitBreaker) {
        this.circuitBreaker.recordSuccess()
      }

      // Cache response
      if (useCache && method === 'GET') {
        this.cache.set(cacheKey, data)
      }

      return data
    } catch (error) {
      clearTimeout(timeoutId)

      // Handle abort/timeout
      if ((error as Error).name === 'AbortError') {
        if (!bypassCircuitBreaker) {
          this.circuitBreaker.recordFailure()
        }
        throw new TimeoutError(this.config.timeout)
      }

      // Network errors
      if (
        error instanceof TypeError ||
        (error as Error).message?.includes('fetch')
      ) {
        if (!bypassCircuitBreaker) {
          this.circuitBreaker.recordFailure()
        }
        throw new NetworkError((error as Error).message, { cause: error as Error })
      }

      throw error
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

