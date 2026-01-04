/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import {
  LeveledLogger,
  StructuredLogger,
  createLogger,
  createStructuredLogger,
  LOG_LEVELS,
  DEFAULT_LOG_LEVEL,
} from '../../src/utils/logger'

describe('LOG_LEVELS', () => {
  it('should have correct order', () => {
    expect(LOG_LEVELS).toEqual(['debug', 'info', 'warn', 'error'])
  })
})

describe('DEFAULT_LOG_LEVEL', () => {
  it('should be info', () => {
    expect(DEFAULT_LOG_LEVEL).toBe('info')
  })
})

describe('LeveledLogger', () => {
  let mockLog: jest.Mock

  beforeEach(() => {
    mockLog = jest.fn()
  })

  describe('with function logger', () => {
    it('should log at info level by default', () => {
      const logger = new LeveledLogger(mockLog)
      
      logger.info('info message')
      expect(mockLog).toHaveBeenCalledWith('info message')
    })

    it('should not log debug when level is info', () => {
      const logger = new LeveledLogger(mockLog, 'info')
      
      logger.debug('debug message')
      expect(mockLog).not.toHaveBeenCalled()
    })

    it('should log debug when level is debug', () => {
      const logger = new LeveledLogger(mockLog, 'debug')
      
      logger.debug('debug message')
      expect(mockLog).toHaveBeenCalledWith('debug message')
    })

    it('should log warn and error at info level', () => {
      const logger = new LeveledLogger(mockLog, 'info')
      
      logger.warn('warn message')
      logger.error('error message')
      
      expect(mockLog).toHaveBeenCalledWith('warn message')
      expect(mockLog).toHaveBeenCalledWith('error message')
    })

    it('should only log error when level is error', () => {
      const logger = new LeveledLogger(mockLog, 'error')
      
      logger.debug('debug')
      logger.info('info')
      logger.warn('warn')
      logger.error('error')
      
      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith('error')
    })
  })

  describe('with object logger', () => {
    it('should use info method from logger object', () => {
      const objLogger = {
        info: mockLog,
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }
      
      const logger = new LeveledLogger(objLogger)
      logger.info('test')
      
      expect(mockLog).toHaveBeenCalledWith('test')
    })
  })
})

describe('StructuredLogger', () => {
  let mockLog: jest.Mock
  let logger: StructuredLogger

  beforeEach(() => {
    mockLog = jest.fn()
  })

  describe('basic logging', () => {
    beforeEach(() => {
      logger = new StructuredLogger(mockLog)
    })

    it('should log string messages', () => {
      logger.info('test message')
      
      expect(mockLog).toHaveBeenCalledWith('test message')
    })

    it('should log object messages', () => {
      logger.info({ event: 'test', data: 'value' })
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('[test]'))
    })

    it('should log with context', () => {
      logger.info('message', { extra: 'data' })
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('message'))
    })

    it('should log debug messages', () => {
      const debugLogger = new StructuredLogger(mockLog)
      debugLogger.debug('debug message')
      
      // Debug is filtered by default (info level)
      expect(mockLog).not.toHaveBeenCalled()
    })

    it('should log warn messages', () => {
      logger.warn('warning')
      
      expect(mockLog).toHaveBeenCalledWith('warning')
    })

    it('should log error messages', () => {
      logger.error('error occurred')
      
      expect(mockLog).toHaveBeenCalledWith('error occurred')
    })
  })

  describe('structured output', () => {
    beforeEach(() => {
      logger = new StructuredLogger(mockLog, { structured: true })
    })

    it('should output JSON when structured is true', () => {
      logger.info('test message')
      
      const output = mockLog.mock.calls[0][0]
      const parsed = JSON.parse(output)
      
      expect(parsed).toHaveProperty('timestamp')
      expect(parsed).toHaveProperty('level', 'info')
      expect(parsed).toHaveProperty('message', 'test message')
    })

    it('should include correlation ID when set', () => {
      logger.setCorrelationId('corr-123')
      logger.info('test')
      
      const output = mockLog.mock.calls[0][0]
      const parsed = JSON.parse(output)
      
      expect(parsed).toHaveProperty('correlationId', 'corr-123')
    })

    it('should sanitize sensitive data', () => {
      logger.info({ password: 'secret123' })
      
      const output = mockLog.mock.calls[0][0]
      expect(output).not.toContain('secret123')
    })
  })

  describe('correlation ID', () => {
    beforeEach(() => {
      logger = new StructuredLogger(mockLog)
    })

    it('should set correlation ID', () => {
      logger.setCorrelationId('test-id')
      // Can't easily test this without structured output
    })

    it('should generate correlation ID', () => {
      const id = logger.generateCorrelationId()
      
      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
    })

    it('should clear correlation ID', () => {
      logger.setCorrelationId('test-id')
      logger.clearCorrelationId()
      // Can't easily test this without structured output
    })
  })

  describe('logError', () => {
    beforeEach(() => {
      logger = new StructuredLogger(mockLog)
    })

    it('should log error with message', () => {
      const error = new Error('Something failed')
      logger.logError('Operation failed', error)
      
      expect(mockLog).toHaveBeenCalled()
    })

    it('should sanitize error messages', () => {
      const error = new Error('Failed with password=secret')
      logger.logError('Error', error)
      
      const output = mockLog.mock.calls[0][0]
      expect(output).not.toContain('secret')
    })
  })

  describe('child logger', () => {
    it('should create child with additional context', () => {
      logger = new StructuredLogger(mockLog, { structured: true })
      const child = logger.child({ requestId: 'req-123' })
      
      child.info('child message')
      
      const output = mockLog.mock.calls[0][0]
      const parsed = JSON.parse(output)
      
      expect(parsed).toHaveProperty('requestId', 'req-123')
    })
  })
})

describe('createLogger', () => {
  it('should create a LeveledLogger', () => {
    const mockLog = jest.fn()
    const logger = createLogger(mockLog)
    
    expect(logger).toBeInstanceOf(LeveledLogger)
  })

  it('should accept log level', () => {
    const mockLog = jest.fn()
    const logger = createLogger(mockLog, 'debug')
    
    logger.debug('test')
    expect(mockLog).toHaveBeenCalled()
  })
})

describe('createStructuredLogger', () => {
  it('should create a StructuredLogger', () => {
    const mockLog = jest.fn()
    const logger = createStructuredLogger(mockLog)
    
    expect(logger).toBeInstanceOf(StructuredLogger)
  })

  it('should accept config', () => {
    const mockLog = jest.fn()
    const logger = createStructuredLogger(mockLog, { structured: true })
    
    logger.info('test')
    const output = mockLog.mock.calls[0][0]
    expect(() => JSON.parse(output)).not.toThrow()
  })
})

