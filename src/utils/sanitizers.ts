/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Data sanitization utilities for security
 */

/**
 * Patterns for sensitive data that should be redacted
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /password[=:]\s*\S+/gi, replacement: 'password=***' },
  { pattern: /token[=:]\s*\S+/gi, replacement: 'token=***' },
  { pattern: /email[=:]\s*\S+/gi, replacement: 'email=***' },
  { pattern: /authorization[=:]\s*\S+/gi, replacement: 'Authorization=***' },
  { pattern: /bearer\s+\S+/gi, replacement: 'Bearer ***' },
  { pattern: /"password"\s*:\s*"[^"]+"/gi, replacement: '"password":"***"' },
  { pattern: /"token"\s*:\s*"[^"]+"/gi, replacement: '"token":"***"' },
  { pattern: /"id"\s*:\s*"[a-zA-Z0-9]{20,}"/gi, replacement: '"id":"***"' },
]

/**
 * Sanitize error messages to prevent exposing sensitive data
 */
export function sanitizeError(err: unknown): string {
  let message: string
  
  if (err instanceof Error) {
    message = err.message
  } else if (typeof err === 'string') {
    message = err
  } else {
    message = String(err)
  }
  
  return sanitizeString(message)
}

/**
 * Sanitize a string by removing sensitive data
 */
export function sanitizeString(str: string): string {
  let result = str
  
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  
  return result
}

const HAP_NAME_MAX_LENGTH = 64

/**
 * Sanitize a HomeKit accessory/service name for Homebridge 2 / HAP-NodeJS validation.
 */
export function sanitizeHapName(name: string, fallback = 'Leviton Device'): string {
  const sanitized = name
    .replace(/[^\p{L}\p{N} ']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

  const validName = sanitized || fallback
  const truncated = validName.slice(0, HAP_NAME_MAX_LENGTH).trim()
  const trimmed = truncated.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

  return trimmed || fallback
}

/**
 * Sanitize an object by redacting sensitive fields
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sensitiveKeys = new Set([
    'password',
    'token',
    'authorization',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
  ])
  
  const result: Record<string, unknown> = {}
  
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      result[key] = '***'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value as Record<string, unknown>)
    } else if (typeof value === 'string') {
      result[key] = sanitizeString(value)
    } else {
      result[key] = value
    }
  }
  
  return result as T
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number, suffix = '...'): string {
  if (str.length <= maxLength) {
    return str
  }
  return str.substring(0, maxLength - suffix.length) + suffix
}

/**
 * Mask a token for logging (show first and last few characters)
 */
export function maskToken(token: string, visibleChars = 4): string {
  if (token.length <= visibleChars * 2) {
    return '***'
  }
  return `${token.substring(0, visibleChars)}...${token.substring(token.length - visibleChars)}`
}

/**
 * Create a safe preview of a response body for logging
 */
export function createResponsePreview(body: string, maxLength = 200): string {
  const sanitized = sanitizeString(body)
  return truncate(sanitized, maxLength)
}

/**
 * Sanitize stack trace by removing file paths that might expose system info
 */
export function sanitizeStackTrace(stack: string | undefined): string | undefined {
  if (!stack) {return undefined}
  
  // Remove absolute paths, keep relative
  return stack.replace(/\s+at\s+.*\((\/[^)]+)\)/g, (match, path) => {
    const filename = path.split('/').pop() || path
    return match.replace(path, filename)
  })
}

