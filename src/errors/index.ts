/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Structured error hierarchy for better error handling
 */

/**
 * Base error class for all Leviton plugin errors
 */
export abstract class LevitonError extends Error {
  abstract code: string
  abstract readonly isRetryable: boolean
  readonly httpStatus?: number
  readonly timestamp: Date

  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = this.constructor.name
    this.timestamp = new Date()
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Convert to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      isRetryable: this.isRetryable,
      httpStatus: this.httpStatus,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    }
  }
}

/**
 * Authentication/authorization errors (401, 403)
 */
export class AuthenticationError extends LevitonError {
  code = 'AUTH_ERROR'
  readonly isRetryable = true
  readonly httpStatus = 401

  constructor(message = 'Authentication failed', options?: { cause?: Error }) {
    super(message, options)
  }
}

/**
 * Token expired error - specific case of auth error
 */
export class TokenExpiredError extends AuthenticationError {
  constructor(message = 'Authentication token has expired', options?: { cause?: Error }) {
    super(message, options)
    this.code = 'TOKEN_EXPIRED'
  }
}

/**
 * Rate limiting errors (429)
 */
export class RateLimitError extends LevitonError {
  readonly code = 'RATE_LIMITED'
  readonly isRetryable = true
  readonly httpStatus = 429
  readonly retryAfter: number

  constructor(message = 'Rate limit exceeded', retryAfter = 60, options?: { cause?: Error }) {
    super(message, options)
    this.retryAfter = retryAfter
  }
}

/**
 * Device offline/unreachable errors
 */
export class DeviceOfflineError extends LevitonError {
  readonly code = 'DEVICE_OFFLINE'
  readonly isRetryable = false
  readonly deviceId: string
  readonly deviceName?: string

  constructor(deviceId: string, deviceName?: string, options?: { cause?: Error }) {
    super(`Device ${deviceName || deviceId} is offline or unreachable`, options)
    this.deviceId = deviceId
    this.deviceName = deviceName
  }
}

/**
 * Device not found errors
 */
export class DeviceNotFoundError extends LevitonError {
  readonly code = 'DEVICE_NOT_FOUND'
  readonly isRetryable = false
  readonly httpStatus = 404
  readonly deviceId: string

  constructor(deviceId: string, options?: { cause?: Error }) {
    super(`Device ${deviceId} not found`, options)
    this.deviceId = deviceId
  }
}

/**
 * Circuit breaker open errors
 */
export class CircuitBreakerError extends LevitonError {
  readonly code = 'CIRCUIT_OPEN'
  readonly isRetryable = true
  readonly resetTime: Date

  constructor(resetTimeMs: number, options?: { cause?: Error }) {
    const resetTime = new Date(Date.now() + resetTimeMs)
    super(`Circuit breaker is open. Service unavailable until ${resetTime.toISOString()}`, options)
    this.resetTime = resetTime
  }

  get retryAfterMs(): number {
    return Math.max(0, this.resetTime.getTime() - Date.now())
  }
}

/**
 * Network/connectivity errors
 */
export class NetworkError extends LevitonError {
  code = 'NETWORK_ERROR'
  readonly isRetryable = true
  readonly originalError?: Error

  constructor(message = 'Network request failed', options?: { cause?: Error }) {
    super(message, options)
    this.originalError = options?.cause
  }
}

/**
 * Request timeout errors
 */
export class TimeoutError extends NetworkError {
  readonly timeoutMs: number

  constructor(timeoutMs: number, options?: { cause?: Error }) {
    super(`Request timed out after ${timeoutMs}ms`, options)
    this.code = 'TIMEOUT'
    this.timeoutMs = timeoutMs
  }
}

/**
 * API response parsing errors
 */
export class ApiParseError extends LevitonError {
  readonly code = 'PARSE_ERROR'
  readonly isRetryable = false
  readonly responsePreview?: string

  constructor(message: string, responsePreview?: string, options?: { cause?: Error }) {
    super(message, options)
    this.responsePreview = responsePreview?.substring(0, 200)
  }
}

/**
 * Invalid API response errors
 */
export class ApiResponseError extends LevitonError {
  readonly code = 'API_ERROR'
  readonly isRetryable: boolean
  readonly httpStatus: number
  readonly responseBody?: string

  constructor(
    httpStatus: number,
    statusText: string,
    responseBody?: string,
    options?: { cause?: Error },
  ) {
    super(`API request failed: ${httpStatus} ${statusText}`, options)
    this.httpStatus = httpStatus
    this.responseBody = responseBody?.substring(0, 500)
    // Server errors (5xx) are retryable, client errors (4xx) are not
    this.isRetryable = httpStatus >= 500 && httpStatus < 600
  }
}

/**
 * Configuration validation errors
 */
export class ConfigurationError extends LevitonError {
  readonly code = 'CONFIG_ERROR'
  readonly isRetryable = false
  readonly field?: string
  readonly details?: string[]

  constructor(message: string, field?: string, details?: string[], options?: { cause?: Error }) {
    super(message, options)
    this.field = field
    this.details = details
  }
}

/**
 * Validation errors for input data
 */
export class ValidationError extends LevitonError {
  readonly code = 'VALIDATION_ERROR'
  readonly isRetryable = false
  readonly field: string
  readonly value?: unknown

  constructor(field: string, message: string, value?: unknown, options?: { cause?: Error }) {
    super(`Invalid ${field}: ${message}`, options)
    this.field = field
    this.value = value
  }
}

/**
 * WebSocket connection errors
 */
export class WebSocketError extends LevitonError {
  readonly code = 'WEBSOCKET_ERROR'
  readonly isRetryable = true
  readonly closeCode?: number

  constructor(message: string, closeCode?: number, options?: { cause?: Error }) {
    super(message, options)
    this.closeCode = closeCode
  }
}

/**
 * Error factory for creating appropriate error types from API responses
 */
export function createApiError(
  httpStatus: number,
  statusText: string,
  responseBody?: string,
): LevitonError {
  switch (httpStatus) {
    case 401:
      return new AuthenticationError(`Unauthorized: ${statusText}`)
    case 403:
      return new AuthenticationError(`Forbidden: ${statusText}`)
    case 404:
      return new ApiResponseError(httpStatus, statusText, responseBody)
    case 429:
      return new RateLimitError(`Rate limited: ${statusText}`)
    default:
      return new ApiResponseError(httpStatus, statusText, responseBody)
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof LevitonError) {
    return error.isRetryable
  }
  
  // Network errors from fetch are generally retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('socket hang up')
    )
  }
  
  return false
}

/**
 * Get error code from any error
 */
export function getErrorCode(error: unknown): string {
  if (error instanceof LevitonError) {
    return error.code
  }
  if (error instanceof Error) {
    return error.name || 'UNKNOWN_ERROR'
  }
  return 'UNKNOWN_ERROR'
}

