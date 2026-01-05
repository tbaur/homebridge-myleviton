"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Structured logging utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StructuredLogger = exports.LeveledLogger = exports.DEFAULT_STRUCTURED_LOGGER_CONFIG = exports.DEFAULT_LOG_LEVEL = exports.LOG_LEVELS = void 0;
exports.createLogger = createLogger;
exports.createStructuredLogger = createStructuredLogger;
const sanitizers_1 = require("./sanitizers");
/**
 * Log levels in order of severity
 */
exports.LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
/**
 * Default log level
 */
exports.DEFAULT_LOG_LEVEL = 'info';
/**
 * Default structured logger configuration
 */
exports.DEFAULT_STRUCTURED_LOGGER_CONFIG = {
    structured: false,
    includeCorrelationId: true,
    includeTimestamp: true,
    level: exports.DEFAULT_LOG_LEVEL,
};
/**
 * Logger wrapper that supports level filtering and structured output
 */
class LeveledLogger {
    baseLog;
    minLevel;
    debug;
    info;
    warn;
    error;
    constructor(log, level = exports.DEFAULT_LOG_LEVEL) {
        this.baseLog = typeof log === 'function' ? log : (msg) => log.info(msg);
        this.minLevel = exports.LOG_LEVELS.indexOf(level);
        // Create level methods
        this.debug = this.createLevelMethod('debug');
        this.info = this.createLevelMethod('info');
        this.warn = this.createLevelMethod('warn');
        this.error = this.createLevelMethod('error');
    }
    createLevelMethod(level) {
        const levelIndex = exports.LOG_LEVELS.indexOf(level);
        return (message) => {
            if (levelIndex >= this.minLevel) {
                this.baseLog(message);
            }
        };
    }
}
exports.LeveledLogger = LeveledLogger;
/**
 * Structured logger with correlation ID support
 */
class StructuredLogger {
    log;
    config;
    correlationId = null;
    constructor(log, config = {}) {
        const mergedConfig = { ...exports.DEFAULT_STRUCTURED_LOGGER_CONFIG, ...config };
        this.log = log instanceof LeveledLogger ? log : new LeveledLogger(log, mergedConfig.level);
        this.config = mergedConfig;
    }
    /**
     * Set correlation ID for request tracing
     */
    setCorrelationId(id) {
        this.correlationId = id;
    }
    /**
     * Generate a new correlation ID
     */
    generateCorrelationId() {
        this.correlationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return this.correlationId;
    }
    /**
     * Clear correlation ID
     */
    clearCorrelationId() {
        this.correlationId = null;
    }
    /**
     * Format a log entry
     */
    format(level, message, context) {
        if (this.config.structured) {
            const entry = {
                timestamp: new Date().toISOString(),
                level,
                message: typeof message === 'string' ? message : '',
                ...(typeof message === 'object' ? (0, sanitizers_1.sanitizeObject)(message) : {}),
                ...(context ? (0, sanitizers_1.sanitizeObject)(context) : {}),
            };
            if (this.config.includeCorrelationId && this.correlationId) {
                entry.correlationId = this.correlationId;
            }
            return JSON.stringify(entry);
        }
        // Traditional string format - context is ignored (only used in structured mode)
        if (typeof message === 'object') {
            const { event, ...rest } = message;
            const contextStr = Object.keys(rest).length > 0
                ? ` ${JSON.stringify((0, sanitizers_1.sanitizeObject)(rest))}`
                : '';
            return `[${event || 'log'}]${contextStr}`;
        }
        return message;
    }
    /**
     * Log debug message
     */
    debug(message, context) {
        this.log.debug(this.format('debug', message, context));
    }
    /**
     * Log info message
     */
    info(message, context) {
        this.log.info(this.format('info', message, context));
    }
    /**
     * Log warning message
     */
    warn(message, context) {
        this.log.warn(this.format('warn', message, context));
    }
    /**
     * Log error message
     */
    error(message, context) {
        this.log.error(this.format('error', message, context));
    }
    /**
     * Log an error with stack trace
     */
    logError(message, error, context) {
        const errorInfo = {
            code: error instanceof Error ? error.name : 'UNKNOWN',
            message: (0, sanitizers_1.sanitizeError)(error),
        };
        this.error(message, { ...context, error: errorInfo });
    }
    /**
     * Create a child logger with additional context
     */
    child(context) {
        // Create a new logger that includes the context in every message
        const childLogger = new StructuredLogger(this.log, this.config);
        const originalFormat = childLogger.format.bind(childLogger);
        childLogger['format'] = (level, message, ctx) => {
            return originalFormat(level, message, { ...context, ...ctx });
        };
        return childLogger;
    }
}
exports.StructuredLogger = StructuredLogger;
/**
 * Create a leveled logger from Homebridge logger
 */
function createLogger(log, level = exports.DEFAULT_LOG_LEVEL) {
    return new LeveledLogger(log, level);
}
/**
 * Create a structured logger
 */
function createStructuredLogger(log, config) {
    return new StructuredLogger(log, config);
}
//# sourceMappingURL=logger.js.map