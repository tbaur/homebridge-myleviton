/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  LevitonError,
  AuthenticationError,
  TokenExpiredError,
  RateLimitError,
  DeviceOfflineError,
  DeviceNotFoundError,
  CircuitBreakerError,
  NetworkError,
  TimeoutError,
  ApiParseError,
  ApiResponseError,
  ConfigurationError,
  ValidationError,
  WebSocketError,
  createApiError,
  isRetryableError,
  getErrorCode,
} from '../../src/errors'

describe('Error Hierarchy', () => {
  describe('LevitonError base class', () => {
    it('should have proper inheritance', () => {
      const error = new AuthenticationError('test')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(LevitonError)
      expect(error).toBeInstanceOf(AuthenticationError)
    })

    it('should have timestamp', () => {
      const before = new Date()
      const error = new AuthenticationError('test')
      const after = new Date()
      
      expect(error.timestamp).toBeInstanceOf(Date)
      expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should serialize to JSON', () => {
      const error = new AuthenticationError('test error')
      const json = error.toJSON()
      
      expect(json).toHaveProperty('name', 'AuthenticationError')
      expect(json).toHaveProperty('code', 'AUTH_ERROR')
      expect(json).toHaveProperty('message', 'test error')
      expect(json).toHaveProperty('isRetryable', true)
      expect(json).toHaveProperty('timestamp')
    })
  })

  describe('AuthenticationError', () => {
    it('should have correct properties', () => {
      const error = new AuthenticationError('auth failed')
      
      expect(error.code).toBe('AUTH_ERROR')
      expect(error.isRetryable).toBe(true)
      expect(error.httpStatus).toBe(401)
      expect(error.message).toBe('auth failed')
    })

    it('should have default message', () => {
      const error = new AuthenticationError()
      expect(error.message).toBe('Authentication failed')
    })
  })

  describe('TokenExpiredError', () => {
    it('should extend AuthenticationError', () => {
      const error = new TokenExpiredError()
      
      expect(error).toBeInstanceOf(AuthenticationError)
      expect(error.code).toBe('TOKEN_EXPIRED')
    })
  })

  describe('RateLimitError', () => {
    it('should have retryAfter', () => {
      const error = new RateLimitError('rate limited', 30)
      
      expect(error.code).toBe('RATE_LIMITED')
      expect(error.isRetryable).toBe(true)
      expect(error.httpStatus).toBe(429)
      expect(error.retryAfter).toBe(30)
    })

    it('should have default retryAfter', () => {
      const error = new RateLimitError()
      expect(error.retryAfter).toBe(60)
    })
  })

  describe('DeviceOfflineError', () => {
    it('should include device info', () => {
      const error = new DeviceOfflineError('dev123', 'Living Room Light')
      
      expect(error.code).toBe('DEVICE_OFFLINE')
      expect(error.isRetryable).toBe(false)
      expect(error.deviceId).toBe('dev123')
      expect(error.deviceName).toBe('Living Room Light')
      expect(error.message).toContain('Living Room Light')
    })

    it('should work without device name', () => {
      const error = new DeviceOfflineError('dev123')
      expect(error.message).toContain('dev123')
    })
  })

  describe('DeviceNotFoundError', () => {
    it('should include device ID', () => {
      const error = new DeviceNotFoundError('dev123')
      
      expect(error.code).toBe('DEVICE_NOT_FOUND')
      expect(error.isRetryable).toBe(false)
      expect(error.httpStatus).toBe(404)
      expect(error.deviceId).toBe('dev123')
    })
  })

  describe('CircuitBreakerError', () => {
    it('should calculate reset time', () => {
      const error = new CircuitBreakerError(5000)
      
      expect(error.code).toBe('CIRCUIT_OPEN')
      expect(error.isRetryable).toBe(true)
      expect(error.resetTime).toBeInstanceOf(Date)
      expect(error.retryAfterMs).toBeLessThanOrEqual(5000)
      expect(error.retryAfterMs).toBeGreaterThan(0)
    })
  })

  describe('NetworkError', () => {
    it('should store original error', () => {
      const cause = new Error('ECONNRESET')
      const error = new NetworkError('Network failed', { cause })
      
      expect(error.code).toBe('NETWORK_ERROR')
      expect(error.isRetryable).toBe(true)
      expect(error.originalError).toBe(cause)
    })
  })

  describe('TimeoutError', () => {
    it('should extend NetworkError', () => {
      const error = new TimeoutError(10000)
      
      expect(error).toBeInstanceOf(NetworkError)
      expect(error.code).toBe('TIMEOUT')
      expect(error.timeoutMs).toBe(10000)
      expect(error.message).toContain('10000')
    })
  })

  describe('ApiParseError', () => {
    it('should include response preview', () => {
      const longResponse = 'x'.repeat(300)
      const error = new ApiParseError('Parse failed', longResponse)
      
      expect(error.code).toBe('PARSE_ERROR')
      expect(error.isRetryable).toBe(false)
      expect(error.responsePreview).toHaveLength(200)
    })
  })

  describe('ApiResponseError', () => {
    it('should be retryable for 5xx errors', () => {
      const error500 = new ApiResponseError(500, 'Server Error')
      const error502 = new ApiResponseError(502, 'Bad Gateway')
      const error400 = new ApiResponseError(400, 'Bad Request')
      
      expect(error500.isRetryable).toBe(true)
      expect(error502.isRetryable).toBe(true)
      expect(error400.isRetryable).toBe(false)
    })
  })

  describe('ConfigurationError', () => {
    it('should include field and details', () => {
      const error = new ConfigurationError(
        'Config invalid',
        'email',
        ['email is required', 'email format invalid'],
      )
      
      expect(error.code).toBe('CONFIG_ERROR')
      expect(error.isRetryable).toBe(false)
      expect(error.field).toBe('email')
      expect(error.details).toEqual(['email is required', 'email format invalid'])
    })
  })

  describe('ValidationError', () => {
    it('should include field and value', () => {
      const error = new ValidationError('brightness', 'must be 0-100', 150)
      
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.isRetryable).toBe(false)
      expect(error.field).toBe('brightness')
      expect(error.value).toBe(150)
      expect(error.message).toContain('brightness')
    })
  })

  describe('WebSocketError', () => {
    it('should include close code', () => {
      const error = new WebSocketError('Connection lost', 1006)
      
      expect(error.code).toBe('WEBSOCKET_ERROR')
      expect(error.isRetryable).toBe(true)
      expect(error.closeCode).toBe(1006)
    })
  })
})

describe('createApiError factory', () => {
  it('should create AuthenticationError for 401', () => {
    const error = createApiError(401, 'Unauthorized')
    expect(error).toBeInstanceOf(AuthenticationError)
  })

  it('should create AuthenticationError for 403', () => {
    const error = createApiError(403, 'Forbidden')
    expect(error).toBeInstanceOf(AuthenticationError)
  })

  it('should create RateLimitError for 429', () => {
    const error = createApiError(429, 'Too Many Requests')
    expect(error).toBeInstanceOf(RateLimitError)
  })

  it('should create ApiResponseError for other status codes', () => {
    const error = createApiError(500, 'Server Error', 'response body')
    expect(error).toBeInstanceOf(ApiResponseError)
  })
})

describe('isRetryableError', () => {
  it('should return true for retryable LevitonErrors', () => {
    expect(isRetryableError(new AuthenticationError())).toBe(true)
    expect(isRetryableError(new RateLimitError())).toBe(true)
    expect(isRetryableError(new NetworkError())).toBe(true)
    expect(isRetryableError(new CircuitBreakerError(1000))).toBe(true)
  })

  it('should return false for non-retryable LevitonErrors', () => {
    expect(isRetryableError(new DeviceOfflineError('dev1'))).toBe(false)
    expect(isRetryableError(new ConfigurationError('config'))).toBe(false)
    expect(isRetryableError(new ValidationError('field', 'msg'))).toBe(false)
  })

  it('should detect retryable network errors from message', () => {
    expect(isRetryableError(new Error('network error'))).toBe(true)
    expect(isRetryableError(new Error('timeout occurred'))).toBe(true)
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true)
    expect(isRetryableError(new Error('socket hang up'))).toBe(true)
  })

  it('should return false for non-Error values', () => {
    expect(isRetryableError('string')).toBe(false)
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
  })
})

describe('getErrorCode', () => {
  it('should return code from LevitonError', () => {
    expect(getErrorCode(new AuthenticationError())).toBe('AUTH_ERROR')
    expect(getErrorCode(new RateLimitError())).toBe('RATE_LIMITED')
    expect(getErrorCode(new DeviceOfflineError('dev1'))).toBe('DEVICE_OFFLINE')
  })

  it('should return name from regular Error', () => {
    expect(getErrorCode(new TypeError('test'))).toBe('TypeError')
    expect(getErrorCode(new Error('test'))).toBe('Error')
  })

  it('should return UNKNOWN_ERROR for non-Error values', () => {
    expect(getErrorCode('string')).toBe('UNKNOWN_ERROR')
    expect(getErrorCode(null)).toBe('UNKNOWN_ERROR')
  })
})

