/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Structured logging utilities
 */

import type { LogLevel, LogEntry, Logger } from '../types'
import { sanitizeError, sanitizeObject } from './sanitizers'

/**
 * Log levels in order of severity
 */
export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

/**
 * Default log level
 */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info'

/**
 * Structured logger configuration
 */
export interface StructuredLoggerConfig {
  /** Enable structured JSON output */
  structured: boolean
  /** Include correlation ID in logs */
  includeCorrelationId: boolean
  /** Include timestamps */
  includeTimestamp: boolean
  /** Minimum log level */
  level: LogLevel
}

/**
 * Default structured logger configuration
 */
export const DEFAULT_STRUCTURED_LOGGER_CONFIG: StructuredLoggerConfig = {
  structured: false,
  includeCorrelationId: true,
  includeTimestamp: true,
  level: DEFAULT_LOG_LEVEL,
}

/**
 * Logger wrapper that supports level filtering and structured output
 */
export class LeveledLogger {
  private readonly baseLog: (message: string) => void
  private readonly minLevel: number

  debug: (message: string) => void
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void

  constructor(log: Logger | ((message: string) => void), level: LogLevel = DEFAULT_LOG_LEVEL) {
    this.baseLog = typeof log === 'function' ? log : (msg: string) => log.info(msg)
    this.minLevel = LOG_LEVELS.indexOf(level)

    // Create level methods
    this.debug = this.createLevelMethod('debug')
    this.info = this.createLevelMethod('info')
    this.warn = this.createLevelMethod('warn')
    this.error = this.createLevelMethod('error')
  }

  private createLevelMethod(level: LogLevel): (message: string) => void {
    const levelIndex = LOG_LEVELS.indexOf(level)
    return (message: string) => {
      if (levelIndex >= this.minLevel) {
        this.baseLog(message)
      }
    }
  }
}

/**
 * Structured logger with correlation ID support
 */
export class StructuredLogger {
  private readonly log: LeveledLogger
  private readonly config: StructuredLoggerConfig
  private correlationId: string | null = null

  constructor(
    log: Logger | ((message: string) => void),
    config: Partial<StructuredLoggerConfig> = {},
  ) {
    const mergedConfig = { ...DEFAULT_STRUCTURED_LOGGER_CONFIG, ...config }
    this.log = log instanceof LeveledLogger ? log : new LeveledLogger(log, mergedConfig.level)
    this.config = mergedConfig
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(id: string): void {
    this.correlationId = id
  }

  /**
   * Generate a new correlation ID
   */
  generateCorrelationId(): string {
    this.correlationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    return this.correlationId
  }

  /**
   * Clear correlation ID
   */
  clearCorrelationId(): void {
    this.correlationId = null
  }

  /**
   * Format a log entry
   */
  private format(level: LogLevel, message: string | object, context?: object): string {
    if (this.config.structured) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message: typeof message === 'string' ? message : '',
        ...(typeof message === 'object' ? sanitizeObject(message as Record<string, unknown>) : {}),
        ...(context ? sanitizeObject(context as Record<string, unknown>) : {}),
      }

      if (this.config.includeCorrelationId && this.correlationId) {
        entry.correlationId = this.correlationId
      }

      return JSON.stringify(entry)
    }

    // Traditional string format
    let result = ''

    if (typeof message === 'object') {
      const { event, ...rest } = message as { event?: string; [key: string]: unknown }
      const contextStr = Object.keys(rest).length > 0 
        ? ` ${JSON.stringify(sanitizeObject(rest))}` 
        : ''
      result = `[${event || 'log'}]${contextStr}`
    } else {
      result = message
    }

    if (context) {
      result += ` ${JSON.stringify(sanitizeObject(context as Record<string, unknown>))}`
    }

    return result
  }

  /**
   * Log debug message
   */
  debug(message: string | object, context?: object): void {
    this.log.debug(this.format('debug', message, context))
  }

  /**
   * Log info message
   */
  info(message: string | object, context?: object): void {
    this.log.info(this.format('info', message, context))
  }

  /**
   * Log warning message
   */
  warn(message: string | object, context?: object): void {
    this.log.warn(this.format('warn', message, context))
  }

  /**
   * Log error message
   */
  error(message: string | object, context?: object): void {
    this.log.error(this.format('error', message, context))
  }

  /**
   * Log an error with stack trace
   */
  logError(message: string, error: unknown, context?: object): void {
    const errorInfo = {
      code: error instanceof Error ? error.name : 'UNKNOWN',
      message: sanitizeError(error),
    }

    this.error(message, { ...context, error: errorInfo })
  }

  /**
   * Create a child logger with additional context
   */
  child(context: object): StructuredLogger {
    // Create a new logger that includes the context in every message
    const childLogger = new StructuredLogger(this.log, this.config)
    
    const originalFormat = childLogger.format.bind(childLogger)
    childLogger['format'] = (level: LogLevel, message: string | object, ctx?: object) => {
      return originalFormat(level, message, { ...context, ...ctx })
    }
    
    return childLogger
  }
}

/**
 * Create a leveled logger from Homebridge logger
 */
export function createLogger(
  log: Logger | ((message: string) => void),
  level: LogLevel = DEFAULT_LOG_LEVEL,
): LeveledLogger {
  return new LeveledLogger(log, level)
}

/**
 * Create a structured logger
 */
export function createStructuredLogger(
  log: Logger | ((message: string) => void),
  config?: Partial<StructuredLoggerConfig>,
): StructuredLogger {
  return new StructuredLogger(log, config)
}

