/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Structured logging utilities
 */
import type { LogLevel, Logger } from '../types';
/**
 * Log levels in order of severity
 */
export declare const LOG_LEVELS: LogLevel[];
/**
 * Default log level
 */
export declare const DEFAULT_LOG_LEVEL: LogLevel;
/**
 * Structured logger configuration
 */
export interface StructuredLoggerConfig {
    /** Enable structured JSON output */
    structured: boolean;
    /** Include correlation ID in logs */
    includeCorrelationId: boolean;
    /** Include timestamps */
    includeTimestamp: boolean;
    /** Minimum log level */
    level: LogLevel;
}
/**
 * Default structured logger configuration
 */
export declare const DEFAULT_STRUCTURED_LOGGER_CONFIG: StructuredLoggerConfig;
/**
 * Logger wrapper that supports level filtering and structured output
 */
export declare class LeveledLogger {
    private readonly baseLog;
    private readonly minLevel;
    debug: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    constructor(log: Logger | ((message: string) => void), level?: LogLevel);
    private createLevelMethod;
}
/**
 * Structured logger with correlation ID support
 */
export declare class StructuredLogger {
    private readonly log;
    private readonly config;
    private correlationId;
    constructor(log: Logger | ((message: string) => void), config?: Partial<StructuredLoggerConfig>);
    /**
     * Set correlation ID for request tracing
     */
    setCorrelationId(id: string): void;
    /**
     * Generate a new correlation ID
     */
    generateCorrelationId(): string;
    /**
     * Clear correlation ID
     */
    clearCorrelationId(): void;
    /**
     * Format a log entry
     */
    private format;
    /**
     * Log debug message
     */
    debug(message: string | object, context?: object): void;
    /**
     * Log info message
     */
    info(message: string | object, context?: object): void;
    /**
     * Log warning message
     */
    warn(message: string | object, context?: object): void;
    /**
     * Log error message
     */
    error(message: string | object, context?: object): void;
    /**
     * Log an error with stack trace
     */
    logError(message: string, error: unknown, context?: object): void;
    /**
     * Create a child logger with additional context
     */
    child(context: object): StructuredLogger;
}
/**
 * Create a leveled logger from Homebridge logger
 */
export declare function createLogger(log: Logger | ((message: string) => void), level?: LogLevel): LeveledLogger;
/**
 * Create a structured logger
 */
export declare function createStructuredLogger(log: Logger | ((message: string) => void), config?: Partial<StructuredLoggerConfig>): StructuredLogger;
//# sourceMappingURL=logger.d.ts.map