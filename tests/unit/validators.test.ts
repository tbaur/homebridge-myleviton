/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  validateEmail,
  validatePassword,
  validateDeviceId,
  validateSerial,
  validateToken,
  validatePowerState,
  validateBrightness,
  validateConfig,
  assertDefined,
  validateNonEmptyArray,
} from '../../src/utils/validators'
import { ValidationError, ConfigurationError } from '../../src/errors'

describe('validateEmail', () => {
  it('should accept valid emails', () => {
    expect(validateEmail('test@example.com')).toBe('test@example.com')
    expect(validateEmail('user.name@domain.co.uk')).toBe('user.name@domain.co.uk')
    expect(validateEmail('  TEST@EXAMPLE.COM  ')).toBe('test@example.com')
  })

  it('should reject invalid emails', () => {
    expect(() => validateEmail('')).toThrow(ValidationError)
    expect(() => validateEmail(null)).toThrow(ValidationError)
    expect(() => validateEmail('invalid')).toThrow(ValidationError)
    expect(() => validateEmail('missing@domain')).toThrow(ValidationError)
    expect(() => validateEmail('@nodomain.com')).toThrow(ValidationError)
  })

  it('should reject overly long emails', () => {
    const longEmail = 'a'.repeat(250) + '@b.com'
    expect(() => validateEmail(longEmail)).toThrow(ValidationError)
  })
})

describe('validatePassword', () => {
  it('should accept valid passwords', () => {
    expect(validatePassword('password123')).toBe('password123')
    expect(validatePassword('complex!@#$%')).toBe('complex!@#$%')
  })

  it('should reject invalid passwords', () => {
    expect(() => validatePassword('')).toThrow(ValidationError)
    expect(() => validatePassword(null)).toThrow(ValidationError)
    expect(() => validatePassword(123 as unknown as string)).toThrow(ValidationError)
  })

  it('should reject overly long passwords', () => {
    const longPassword = 'a'.repeat(129)
    expect(() => validatePassword(longPassword)).toThrow(ValidationError)
  })
})

describe('validateDeviceId', () => {
  it('should accept valid device IDs', () => {
    expect(validateDeviceId('abc123')).toBe('abc123')
    expect(validateDeviceId('device-123')).toBe('device-123')
    expect(validateDeviceId('  ABC-123  ')).toBe('ABC-123')
  })

  it('should reject invalid device IDs', () => {
    expect(() => validateDeviceId('')).toThrow(ValidationError)
    expect(() => validateDeviceId(null)).toThrow(ValidationError)
    expect(() => validateDeviceId('device@123')).toThrow(ValidationError)
    expect(() => validateDeviceId('device 123')).toThrow(ValidationError)
  })
})

describe('validateSerial', () => {
  it('should accept valid serials', () => {
    expect(validateSerial('ABC123')).toBe('ABC123')
    expect(validateSerial('  abc123  ')).toBe('abc123')
  })

  it('should reject invalid serials', () => {
    expect(() => validateSerial('')).toThrow(ValidationError)
    expect(() => validateSerial(null)).toThrow(ValidationError)
    expect(() => validateSerial('ABC-123')).toThrow(ValidationError)
  })
})

describe('validateToken', () => {
  it('should accept valid tokens', () => {
    expect(validateToken('abc123token')).toBe('abc123token')
    expect(validateToken('  token  ')).toBe('token')
  })

  it('should reject invalid tokens', () => {
    expect(() => validateToken('')).toThrow(ValidationError)
    expect(() => validateToken('   ')).toThrow(ValidationError)
    expect(() => validateToken(null)).toThrow(ValidationError)
  })
})

describe('validatePowerState', () => {
  it('should accept ON and OFF', () => {
    expect(validatePowerState('ON')).toBe('ON')
    expect(validatePowerState('OFF')).toBe('OFF')
  })

  it('should reject other values', () => {
    expect(() => validatePowerState('on')).toThrow(ValidationError)
    expect(() => validatePowerState('off')).toThrow(ValidationError)
    expect(() => validatePowerState('true')).toThrow(ValidationError)
    expect(() => validatePowerState(1)).toThrow(ValidationError)
  })
})

describe('validateBrightness', () => {
  it('should accept valid brightness values', () => {
    expect(validateBrightness(0)).toBe(0)
    expect(validateBrightness(50)).toBe(50)
    expect(validateBrightness(100)).toBe(100)
    expect(validateBrightness(33.7)).toBe(34) // Should round
  })

  it('should reject invalid brightness values', () => {
    expect(() => validateBrightness(-1)).toThrow(ValidationError)
    expect(() => validateBrightness(101)).toThrow(ValidationError)
    expect(() => validateBrightness(NaN)).toThrow(ValidationError)
    expect(() => validateBrightness(Infinity)).toThrow(ValidationError)
    expect(() => validateBrightness('50' as unknown as number)).toThrow(ValidationError)
  })
})

describe('validateConfig', () => {
  const validConfig = {
    email: 'test@example.com',
    password: 'password123',
  }

  it('should accept valid config', () => {
    const result = validateConfig(validConfig)
    expect(result.email).toBe('test@example.com')
    expect(result.password).toBe('password123')
  })

  it('should accept optional fields', () => {
    const config = {
      ...validConfig,
      loglevel: 'debug',
      excludedModels: ['DW4SF'],
      excludedSerials: ['ABC123'],
      pollingInterval: 60,
      connectionTimeout: 15000,
    }
    const result = validateConfig(config)
    expect(result.loglevel).toBe('debug')
    expect(result.excludedModels).toEqual(['DW4SF'])
  })

  it('should reject missing required fields', () => {
    expect(() => validateConfig({})).toThrow(ConfigurationError)
    expect(() => validateConfig({ email: 'test@test.com' })).toThrow(ConfigurationError)
    expect(() => validateConfig({ password: 'pass' })).toThrow(ConfigurationError)
  })

  it('should reject invalid loglevel', () => {
    const config = { ...validConfig, loglevel: 'invalid' }
    expect(() => validateConfig(config)).toThrow(ConfigurationError)
  })

  it('should reject invalid excludedModels type', () => {
    const config = { ...validConfig, excludedModels: 'DW4SF' }
    expect(() => validateConfig(config)).toThrow(ConfigurationError)
  })

  it('should reject invalid pollingInterval', () => {
    expect(() => validateConfig({ ...validConfig, pollingInterval: 5 })).toThrow(ConfigurationError)
    expect(() => validateConfig({ ...validConfig, pollingInterval: 5000 })).toThrow(ConfigurationError)
    expect(() => validateConfig({ ...validConfig, pollingInterval: 'fast' })).toThrow(ConfigurationError)
  })

  it('should reject invalid connectionTimeout', () => {
    expect(() => validateConfig({ ...validConfig, connectionTimeout: 1000 })).toThrow(ConfigurationError)
    expect(() => validateConfig({ ...validConfig, connectionTimeout: 100000 })).toThrow(ConfigurationError)
  })
})

describe('assertDefined', () => {
  it('should return value if defined', () => {
    expect(assertDefined('value', 'field')).toBe('value')
    expect(assertDefined(0, 'field')).toBe(0)
    expect(assertDefined(false, 'field')).toBe(false)
  })

  it('should throw for null or undefined', () => {
    expect(() => assertDefined(null, 'field')).toThrow(ValidationError)
    expect(() => assertDefined(undefined, 'field')).toThrow(ValidationError)
  })
})

describe('validateNonEmptyArray', () => {
  it('should accept non-empty arrays', () => {
    expect(validateNonEmptyArray([1, 2, 3], 'items')).toEqual([1, 2, 3])
    expect(validateNonEmptyArray(['a'], 'items')).toEqual(['a'])
  })

  it('should reject empty arrays', () => {
    expect(() => validateNonEmptyArray([], 'items')).toThrow(ValidationError)
  })

  it('should reject non-arrays', () => {
    expect(() => validateNonEmptyArray('string', 'items')).toThrow(ValidationError)
    expect(() => validateNonEmptyArray(null, 'items')).toThrow(ValidationError)
  })
})

