/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Input validation utilities
 */

import { ValidationError, ConfigurationError } from '../errors'
import type { LevitonConfig, PowerState } from '../types'

/**
 * Email regex pattern
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Device ID pattern (alphanumeric)
 */
const DEVICE_ID_REGEX = /^[a-zA-Z0-9-]+$/

/**
 * Serial number pattern
 */
const SERIAL_REGEX = /^[A-Za-z0-9]+$/

/**
 * Validate email format
 */
export function validateEmail(email: unknown): string {
  if (!email || typeof email !== 'string') {
    throw new ValidationError('email', 'must be a non-empty string')
  }
  
  const trimmed = email.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('email', 'cannot be empty')
  }
  
  if (trimmed.length > 254) {
    throw new ValidationError('email', 'exceeds maximum length of 254 characters')
  }
  
  if (!EMAIL_REGEX.test(trimmed)) {
    throw new ValidationError('email', 'invalid format')
  }
  
  return trimmed.toLowerCase()
}

/**
 * Validate password
 */
export function validatePassword(password: unknown): string {
  if (!password || typeof password !== 'string') {
    throw new ValidationError('password', 'must be a non-empty string')
  }
  
  if (password.length === 0) {
    throw new ValidationError('password', 'cannot be empty')
  }
  
  if (password.length > 128) {
    throw new ValidationError('password', 'exceeds maximum length of 128 characters')
  }
  
  return password
}

/**
 * Validate device ID
 * Accepts strings or numbers (Leviton API returns numeric IDs)
 */
export function validateDeviceId(id: unknown): string {
  // Handle numeric IDs from API
  if (typeof id === 'number' && Number.isFinite(id)) {
    return String(id)
  }
  
  if (!id || typeof id !== 'string') {
    throw new ValidationError('deviceId', 'must be a non-empty string or number')
  }
  
  const trimmed = id.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('deviceId', 'cannot be empty')
  }
  
  if (!DEVICE_ID_REGEX.test(trimmed)) {
    throw new ValidationError('deviceId', 'contains invalid characters')
  }
  
  return trimmed
}

/**
 * Validate device serial
 */
export function validateSerial(serial: unknown): string {
  if (!serial || typeof serial !== 'string') {
    throw new ValidationError('serial', 'must be a non-empty string')
  }
  
  const trimmed = serial.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('serial', 'cannot be empty')
  }
  
  if (!SERIAL_REGEX.test(trimmed)) {
    throw new ValidationError('serial', 'contains invalid characters')
  }
  
  return trimmed
}

/**
 * Validate authentication token
 */
export function validateToken(token: unknown): string {
  if (!token || typeof token !== 'string') {
    throw new ValidationError('token', 'must be a non-empty string')
  }
  
  const trimmed = token.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('token', 'cannot be empty')
  }
  
  return trimmed
}

/**
 * Validate power state
 */
export function validatePowerState(power: unknown): PowerState {
  if (power !== 'ON' && power !== 'OFF') {
    throw new ValidationError('power', "must be 'ON' or 'OFF'", power)
  }
  return power
}

/**
 * Validate brightness value (0-100)
 */
export function validateBrightness(brightness: unknown): number {
  if (typeof brightness !== 'number') {
    throw new ValidationError('brightness', 'must be a number', brightness)
  }
  
  if (!Number.isFinite(brightness)) {
    throw new ValidationError('brightness', 'must be a finite number', brightness)
  }
  
  if (brightness < 0 || brightness > 100) {
    throw new ValidationError('brightness', 'must be between 0 and 100', brightness)
  }
  
  return Math.round(brightness)
}

/**
 * Validate plugin configuration
 */
export function validateConfig(config: unknown): LevitonConfig {
  const errors: string[] = []
  
  if (!config || typeof config !== 'object') {
    throw new ConfigurationError('Configuration must be an object')
  }
  
  const cfg = config as Record<string, unknown>
  
  // Required fields
  if (!cfg.email) {
    errors.push('email is required')
  } else {
    try {
      validateEmail(cfg.email)
    } catch (e) {
      errors.push(`email: ${(e as Error).message}`)
    }
  }
  
  if (!cfg.password) {
    errors.push('password is required')
  } else {
    try {
      validatePassword(cfg.password)
    } catch (e) {
      errors.push(`password: ${(e as Error).message}`)
    }
  }
  
  // Optional fields
  if (cfg.loglevel !== undefined) {
    const validLevels = ['debug', 'info', 'warn', 'error']
    if (!validLevels.includes(cfg.loglevel as string)) {
      errors.push(`loglevel must be one of: ${validLevels.join(', ')}`)
    }
  }
  
  if (cfg.excludedModels !== undefined) {
    if (!Array.isArray(cfg.excludedModels)) {
      errors.push('excludedModels must be an array')
    } else {
      cfg.excludedModels.forEach((model, i) => {
        if (typeof model !== 'string') {
          errors.push(`excludedModels[${i}] must be a string`)
        }
      })
    }
  }
  
  if (cfg.excludedSerials !== undefined) {
    if (!Array.isArray(cfg.excludedSerials)) {
      errors.push('excludedSerials must be an array')
    } else {
      cfg.excludedSerials.forEach((serial, i) => {
        if (typeof serial !== 'string') {
          errors.push(`excludedSerials[${i}] must be a string`)
        }
      })
    }
  }
  
  if (cfg.pollingInterval !== undefined) {
    const interval = cfg.pollingInterval as number
    if (typeof interval !== 'number' || interval < 10 || interval > 3600) {
      errors.push('pollingInterval must be a number between 10 and 3600')
    }
  }
  
  if (cfg.connectionTimeout !== undefined) {
    const timeout = cfg.connectionTimeout as number
    if (typeof timeout !== 'number' || timeout < 5000 || timeout > 60000) {
      errors.push('connectionTimeout must be a number between 5000 and 60000')
    }
  }
  
  if (errors.length > 0) {
    throw new ConfigurationError(
      `Configuration validation failed: ${errors.join('; ')}`,
      undefined,
      errors,
    )
  }
  
  return cfg as unknown as LevitonConfig
}

/**
 * Validate that a value is defined (not null or undefined)
 */
export function assertDefined<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new ValidationError(name, 'is required but was not provided')
  }
  return value
}

/**
 * Validate that a value is a non-empty array
 */
export function validateNonEmptyArray<T>(arr: unknown, name: string): T[] {
  if (!Array.isArray(arr)) {
    throw new ValidationError(name, 'must be an array')
  }
  if (arr.length === 0) {
    throw new ValidationError(name, 'cannot be empty')
  }
  return arr as T[]
}

