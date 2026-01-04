/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Utility exports
 */

// Validators
export {
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
} from './validators'

// Sanitizers
export {
  sanitizeError,
  sanitizeString,
  sanitizeObject,
  truncate,
  maskToken,
  createResponsePreview,
  sanitizeStackTrace,
} from './sanitizers'

// Retry
export {
  withRetry,
  makeRetryable,
  withRetryAndTimeout,
  withRetryContext,
  sleep,
  calculateBackoffDelay,
  DEFAULT_RETRY_POLICY,
  AGGRESSIVE_RETRY_POLICY,
  CONSERVATIVE_RETRY_POLICY,
} from './retry'
export type { RetryContext } from './retry'

// Logger
export {
  LeveledLogger,
  StructuredLogger,
  createLogger,
  createStructuredLogger,
  LOG_LEVELS,
  DEFAULT_LOG_LEVEL,
} from './logger'
export type { StructuredLoggerConfig } from './logger'

