/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  sanitizeError,
  sanitizeString,
  sanitizeObject,
  truncate,
  maskToken,
  createResponsePreview,
  sanitizeStackTrace,
} from '../../src/utils/sanitizers'

describe('sanitizeError', () => {
  it('should sanitize Error messages', () => {
    const error = new Error('Login failed with password=secret123')
    const result = sanitizeError(error)
    expect(result).not.toContain('secret123')
    expect(result).toContain('password=***')
  })

  it('should sanitize string errors', () => {
    const result = sanitizeError('token=abcdef123456')
    expect(result).not.toContain('abcdef123456')
    expect(result).toContain('token=***')
  })

  it('should handle non-Error values', () => {
    expect(sanitizeError(null)).toBe('null')
    expect(sanitizeError(undefined)).toBe('undefined')
    expect(sanitizeError(123)).toBe('123')
  })
})

describe('sanitizeString', () => {
  it('should redact password patterns', () => {
    expect(sanitizeString('password=secret')).toBe('password=***')
    expect(sanitizeString('password: secret')).toBe('password=***')
    expect(sanitizeString('"password": "secret"')).toBe('"password":"***"')
  })

  it('should redact token patterns', () => {
    expect(sanitizeString('token=abc123')).toBe('token=***')
    expect(sanitizeString('"token": "abc123"')).toBe('"token":"***"')
  })

  it('should redact email patterns', () => {
    expect(sanitizeString('email=user@example.com')).toBe('email=***')
  })

  it('should redact authorization headers', () => {
    // The authorization pattern captures up to the first space
    const result = sanitizeString('authorization=Bearer-abc123')
    expect(result).toContain('Authorization=***')
    expect(result).not.toContain('Bearer-abc123')
  })

  it('should redact long IDs in JSON', () => {
    expect(sanitizeString('"id": "abcdefghijklmnopqrstuvwxyz"')).toBe('"id":"***"')
  })

  it('should not redact short IDs', () => {
    const result = sanitizeString('"id": "short"')
    expect(result).toContain('short')
  })
})

describe('sanitizeObject', () => {
  it('should redact sensitive fields', () => {
    const obj = {
      username: 'user',
      password: 'secret',
      token: 'abc123',
      data: 'safe',
    }
    const result = sanitizeObject(obj)
    
    expect(result.username).toBe('user')
    expect(result.password).toBe('***')
    expect(result.token).toBe('***')
    expect(result.data).toBe('safe')
  })

  it('should recursively sanitize nested objects', () => {
    const obj = {
      user: {
        email: 'test@test.com',
        password: 'secret',
      },
    }
    const result = sanitizeObject(obj)
    
    expect((result.user as Record<string, unknown>).password).toBe('***')
  })

  it('should sanitize string values', () => {
    const obj = {
      message: 'Login with password=secret failed',
    }
    const result = sanitizeObject(obj)
    
    expect(result.message).not.toContain('secret')
  })
})

describe('truncate', () => {
  it('should truncate long strings', () => {
    const long = 'a'.repeat(100)
    const result = truncate(long, 20)
    
    expect(result).toHaveLength(20)
    expect(result.endsWith('...')).toBe(true)
  })

  it('should not truncate short strings', () => {
    const short = 'hello'
    const result = truncate(short, 20)
    
    expect(result).toBe('hello')
  })

  it('should use custom suffix', () => {
    const long = 'a'.repeat(100)
    const result = truncate(long, 20, '[...]')
    
    expect(result.endsWith('[...]')).toBe(true)
  })
})

describe('maskToken', () => {
  it('should mask middle of token', () => {
    const result = maskToken('abcdefghijklmnop')
    
    expect(result).toBe('abcd...mnop')
    expect(result).not.toContain('efghijkl')
  })

  it('should handle short tokens', () => {
    const result = maskToken('abc')
    
    expect(result).toBe('***')
  })

  it('should accept custom visible chars', () => {
    const result = maskToken('abcdefghijklmnop', 2)
    
    expect(result).toBe('ab...op')
  })
})

describe('createResponsePreview', () => {
  it('should sanitize and truncate', () => {
    const response = 'Response with password=secret and lots of data ' + 'x'.repeat(300)
    const result = createResponsePreview(response, 100)
    
    expect(result.length).toBeLessThanOrEqual(100)
    expect(result).not.toContain('secret')
    expect(result).toContain('password=***')
  })
})

describe('sanitizeStackTrace', () => {
  it('should remove absolute paths', () => {
    const stack = `Error: test
    at function (/Users/user/project/src/file.js:10:5)
    at another (/home/user/app/index.js:20:3)`
    
    const result = sanitizeStackTrace(stack)
    
    expect(result).not.toContain('/Users/user')
    expect(result).not.toContain('/home/user')
    expect(result).toContain('file.js')
    expect(result).toContain('index.js')
  })

  it('should handle undefined', () => {
    expect(sanitizeStackTrace(undefined)).toBeUndefined()
  })
})

