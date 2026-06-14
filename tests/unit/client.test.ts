/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  LevitonApiClient,
  getApiClient,
  resetGlobalClient,
} from '../../src/api/client'
import { resetGlobalRateLimiter } from '../../src/api/rate-limiter'
import { resetGlobalCircuitBreaker } from '../../src/api/circuit-breaker'
import { resetGlobalCache } from '../../src/api/cache'
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  TimeoutError,
  ApiParseError,
  ApiResponseError,
  ValidationError,
} from '../../src/errors'

// Mock fetch globally
const mockFetch = jest.fn()
global.fetch = mockFetch

describe('LevitonApiClient', () => {
  let client: LevitonApiClient

  beforeEach(() => {
    jest.clearAllMocks()
    resetGlobalClient()
    resetGlobalRateLimiter()
    resetGlobalCircuitBreaker()
    resetGlobalCache()
    // Single attempt by default keeps the error-handling assertions below
    // deterministic; retry behavior is covered in its own describe block.
    client = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 1 })
  })

  afterEach(() => {
    client.reset()
  })

  const mockJsonResponse = (data: unknown, status = 200, statusText = 'OK') => {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: new Map([['content-type', 'application/json']]) as unknown as Headers,
      text: () => Promise.resolve(JSON.stringify(data)),
    })
  }

  const mockErrorResponse = (status: number, statusText: string, body = '') => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      statusText,
      headers: new Map([['content-type', 'application/json']]) as unknown as Headers,
      text: () => Promise.resolve(body),
    })
  }

  describe('login', () => {
    it('should login successfully', async () => {
      mockJsonResponse({ id: 'token123', userId: 'user1' })

      const result = await client.login('test@example.com', 'password123')

      expect(result.id).toBe('token123')
      expect(result.userId).toBe('user1')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/Person/login'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test@example.com'),
        }),
      )
    })

    it('should throw on invalid email', async () => {
      await expect(client.login('invalid', 'password')).rejects.toThrow(ValidationError)
    })

    it('should throw on empty password', async () => {
      await expect(client.login('test@example.com', '')).rejects.toThrow(ValidationError)
    })

    it('should throw AuthenticationError on 401', async () => {
      mockErrorResponse(401, 'Unauthorized')

      await expect(client.login('test@example.com', 'password')).rejects.toThrow(AuthenticationError)
    })

    it('should throw on invalid login response', async () => {
      mockJsonResponse({ invalid: 'response' })

      await expect(client.login('test@example.com', 'password')).rejects.toThrow(AuthenticationError)
    })
  })

  describe('getResidentialPermissions', () => {
    it('should fetch permissions', async () => {
      mockJsonResponse([{ residentialAccountId: 'acc1' }])

      const result = await client.getResidentialPermissions('person1', 'token123')

      expect(result).toHaveLength(1)
      expect(result[0].residentialAccountId).toBe('acc1')
    })

    it('should throw on invalid person ID', async () => {
      await expect(client.getResidentialPermissions('', 'token')).rejects.toThrow(ValidationError)
    })

    it('should throw on invalid token', async () => {
      await expect(client.getResidentialPermissions('person1', '')).rejects.toThrow(ValidationError)
    })
  })

  describe('getResidentialAccount', () => {
    it('should fetch account', async () => {
      mockJsonResponse({ id: 'acc1', primaryResidenceId: 'res1' })

      const result = await client.getResidentialAccount('acc1', 'token123')

      expect(result.id).toBe('acc1')
      expect(result.primaryResidenceId).toBe('res1')
    })
  })

  describe('getResidences', () => {
    it('should fetch residences', async () => {
      mockJsonResponse([{ id: 'res1' }, { id: 'res2' }])

      const result = await client.getResidences('acc1', 'token123')

      expect(result).toHaveLength(2)
    })
  })

  describe('getDevices', () => {
    it('should fetch devices', async () => {
      mockJsonResponse([
        { id: 'dev1', name: 'Light 1', serial: 'SER1', model: 'DW6HD' },
        { id: 'dev2', name: 'Light 2', serial: 'SER2', model: 'DW6HD' },
      ])

      const result = await client.getDevices('res1', 'token123')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Light 1')
    })
  })

  describe('getDeviceStatus', () => {
    it('should fetch device status', async () => {
      mockJsonResponse({ power: 'ON', brightness: 75 })

      const result = await client.getDeviceStatus('dev1', 'token123')

      expect(result.power).toBe('ON')
      expect(result.brightness).toBe(75)
    })

    it('should cache responses', async () => {
      mockJsonResponse({ power: 'ON', brightness: 75 })

      await client.getDeviceStatus('dev1', 'token123')
      await client.getDeviceStatus('dev1', 'token123')

      // Should only make one request due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('setDeviceState', () => {
    it('should set power state', async () => {
      mockJsonResponse({ power: 'OFF', brightness: 0 })

      const result = await client.setDeviceState('dev1', 'token123', { power: 'OFF' })

      expect(result.power).toBe('OFF')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/IotSwitches/dev1'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('OFF'),
        }),
      )
    })

    it('should set brightness', async () => {
      mockJsonResponse({ power: 'ON', brightness: 50 })

      const result = await client.setDeviceState('dev1', 'token123', { brightness: 50 })

      expect(result.brightness).toBe(50)
    })

    it('should throw on invalid brightness', async () => {
      await expect(
        client.setDeviceState('dev1', 'token123', { brightness: 150 }),
      ).rejects.toThrow(ValidationError)
    })

    it('should throw on invalid power state', async () => {
      await expect(
        client.setDeviceState('dev1', 'token123', { power: 'INVALID' as 'ON' }),
      ).rejects.toThrow(ValidationError)
    })

    it('should throw if no state provided', async () => {
      await expect(
        client.setDeviceState('dev1', 'token123', {}),
      ).rejects.toThrow(ValidationError)
    })

    it('should invalidate cache after update', async () => {
      mockJsonResponse({ power: 'ON', brightness: 75 })
      mockJsonResponse({ power: 'OFF', brightness: 0 })
      mockJsonResponse({ power: 'OFF', brightness: 0 })

      await client.getDeviceStatus('dev1', 'token123')
      await client.setDeviceState('dev1', 'token123', { power: 'OFF' })
      await client.getDeviceStatus('dev1', 'token123')

      // Should make 3 requests (cache invalidated after set)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('setPower', () => {
    it('should set power on', async () => {
      mockJsonResponse({ power: 'ON' })

      await client.setPower('dev1', 'token123', true)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('ON'),
        }),
      )
    })

    it('should set power off', async () => {
      mockJsonResponse({ power: 'OFF' })

      await client.setPower('dev1', 'token123', false)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('OFF'),
        }),
      )
    })
  })

  describe('setBrightness', () => {
    it('should set brightness', async () => {
      mockJsonResponse({ power: 'ON', brightness: 75 })

      await client.setBrightness('dev1', 'token123', 75)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('75'),
        }),
      )
    })
  })

  describe('error handling', () => {
    it('should handle rate limit errors', async () => {
      mockErrorResponse(429, 'Too Many Requests')

      await expect(client.getDevices('res1', 'token123')).rejects.toThrow(RateLimitError)
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      await expect(client.getDevices('res1', 'token123')).rejects.toThrow(NetworkError)
    })

    it('should handle timeout', async () => {
      mockFetch.mockImplementationOnce(() => new Promise((_, reject) => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        setTimeout(() => reject(error), 50)
      }))

      await expect(client.getDevices('res1', 'token123')).rejects.toThrow(TimeoutError)
    })

    it('should handle parse errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]) as unknown as Headers,
        text: () => Promise.resolve('not json'),
      })

      await expect(client.getDevices('res1', 'token123')).rejects.toThrow(ApiParseError)
    })

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]) as unknown as Headers,
        text: () => Promise.resolve(''),
      })

      await expect(client.getDevices('res1', 'token123')).rejects.toThrow(ApiParseError)
    })

    it('should handle 5xx errors and trip circuit breaker', async () => {
      // Make 5 failures to trip circuit breaker
      for (let i = 0; i < 5; i++) {
        mockErrorResponse(500, 'Server Error')
      }

      for (let i = 0; i < 5; i++) {
        await expect(client.getDevices('res1', 'token123')).rejects.toThrow(ApiResponseError)
      }

      // Next request should fail due to circuit breaker
      mockJsonResponse([]) // This won't be called
      await expect(client.getDevices('res1', 'token123')).rejects.toThrow(/circuit breaker/i)
    })
  })

  describe('retry behavior', () => {
    it('retries a transient 5xx then succeeds', async () => {
      const retryClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 3 })
      mockErrorResponse(503, 'Service Unavailable')
      mockJsonResponse([{ id: 'd1' }])

      const result = await retryClient.getDevices('res1', 'token123')

      expect(result).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('retries a network error then succeeds', async () => {
      const retryClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 3 })
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      mockJsonResponse([])

      const result = await retryClient.getDevices('res1', 'token123')

      expect(result).toEqual([])
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('does not retry auth (401) errors', async () => {
      const retryClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 3 })
      mockErrorResponse(401, 'Unauthorized')

      await expect(retryClient.getDevices('res1', 'token123')).rejects.toThrow(AuthenticationError)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('does not retry rate-limit (429) errors', async () => {
      const retryClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 3 })
      mockErrorResponse(429, 'Too Many Requests')

      await expect(retryClient.getDevices('res1', 'token123')).rejects.toThrow(RateLimitError)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('gives up after maxRetryAttempts on persistent 5xx', async () => {
      const retryClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 3 })
      for (let i = 0; i < 3; i++) {
        mockErrorResponse(500, 'Server Error')
      }

      await expect(retryClient.getDevices('res1', 'token123')).rejects.toThrow(ApiResponseError)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('metrics hook', () => {
    it('fires with ok=true and a duration on a successful request', async () => {
      const metrics = jest.fn()
      const metricsClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 1, metrics })
      mockJsonResponse([{ id: 'd1' }])

      await metricsClient.getDevices('res1', 'token123')

      expect(metrics).toHaveBeenCalledTimes(1)
      const sample = metrics.mock.calls[0][0]
      expect(sample.ok).toBe(true)
      expect(typeof sample.durationMs).toBe('number')
      expect(sample.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('fires with ok=false on an error response', async () => {
      const metrics = jest.fn()
      const metricsClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 1, metrics })
      mockErrorResponse(500, 'Server Error')

      await expect(metricsClient.getDevices('res1', 'token123')).rejects.toThrow(ApiResponseError)

      expect(metrics).toHaveBeenCalledTimes(1)
      expect(metrics.mock.calls[0][0].ok).toBe(false)
    })

    it('fires with ok=false on a timeout', async () => {
      const metrics = jest.fn()
      const metricsClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 1, metrics })
      mockFetch.mockImplementationOnce(() => new Promise((_, reject) => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        setTimeout(() => reject(error), 20)
      }))

      await expect(metricsClient.getDevices('res1', 'token123')).rejects.toThrow(TimeoutError)

      expect(metrics).toHaveBeenCalledTimes(1)
      expect(metrics.mock.calls[0][0].ok).toBe(false)
    })

    it('fires once per logical request even when retries occur', async () => {
      const metrics = jest.fn()
      const metricsClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 3, metrics })
      mockErrorResponse(503, 'Service Unavailable')
      mockJsonResponse([{ id: 'd1' }])

      await metricsClient.getDevices('res1', 'token123')

      // Two network attempts, but one logical request → one metrics sample.
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(metrics).toHaveBeenCalledTimes(1)
      expect(metrics.mock.calls[0][0].ok).toBe(true)
    })

    it('does not fire on a cache hit', async () => {
      const metrics = jest.fn()
      const metricsClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 1, metrics })
      mockJsonResponse({ power: 'ON', brightness: 75 })

      await metricsClient.getDeviceStatus('dev1', 'token123')
      await metricsClient.getDeviceStatus('dev1', 'token123')

      // Second call is served from cache (no network request) → only one sample.
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(metrics).toHaveBeenCalledTimes(1)
    })

    it('reports networked=true when a fetch is attempted', async () => {
      const metrics = jest.fn()
      const metricsClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 1, metrics })
      mockJsonResponse([{ id: 'd1' }])

      await metricsClient.getDevices('res1', 'token123')

      expect(metrics.mock.calls[0][0].networked).toBe(true)
    })

    it('reports networked=false for a pre-flight circuit-breaker rejection', async () => {
      const metrics = jest.fn()
      const metricsClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 1, metrics })

      // Five 5xx failures (failureThreshold) open the breaker.
      for (let i = 0; i < 5; i++) {
        mockErrorResponse(500, 'Server Error')
        await expect(metricsClient.getDevices('res1', 'token123')).rejects.toThrow(ApiResponseError)
      }

      metrics.mockClear()
      // The next request is rejected before any fetch is attempted.
      await expect(metricsClient.getDevices('res1', 'token123')).rejects.toThrow(ApiResponseError)

      expect(mockFetch).toHaveBeenCalledTimes(5)
      expect(metrics).toHaveBeenCalledTimes(1)
      const sample = metrics.mock.calls[0][0]
      expect(sample.ok).toBe(false)
      expect(sample.networked).toBe(false)
    })
  })

  describe('onCircuitOpen hook', () => {
    it('fires once when the breaker transitions into the open state', async () => {
      const onCircuitOpen = jest.fn()
      const breakerClient = new LevitonApiClient({ timeout: 1000, maxRetryAttempts: 1, onCircuitOpen })

      for (let i = 0; i < 5; i++) {
        mockErrorResponse(500, 'Server Error')
        await expect(breakerClient.getDevices('res1', 'token123')).rejects.toThrow(ApiResponseError)
      }

      expect(onCircuitOpen).toHaveBeenCalledTimes(1)
    })
  })

  describe('cache management', () => {
    it('should clear cache', () => {
      client.clearCache()
      // No error means success
    })

    it('should invalidate device cache', () => {
      client.invalidateDeviceCache('dev1')
      // No error means success
    })
  })

  describe('getStatus', () => {
    it('should return client status', () => {
      const status = client.getStatus()

      expect(status).toHaveProperty('circuitBreaker')
      expect(status).toHaveProperty('rateLimiter')
      expect(status).toHaveProperty('cache')
    })
  })

  describe('reset', () => {
    it('should reset all state', () => {
      client.reset()
      // No error means success
    })
  })
})

describe('getApiClient', () => {
  beforeEach(() => {
    resetGlobalClient()
  })

  it('should return same instance', () => {
    const client1 = getApiClient()
    const client2 = getApiClient()

    expect(client1).toBe(client2)
  })
})

describe('resetGlobalClient', () => {
  it('should reset the global client', () => {
    const client1 = getApiClient()
    resetGlobalClient()
    const client2 = getApiClient()

    expect(client1).not.toBe(client2)
  })
})

