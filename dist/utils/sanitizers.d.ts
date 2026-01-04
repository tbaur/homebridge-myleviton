/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Data sanitization utilities for security
 */
/**
 * Sanitize error messages to prevent exposing sensitive data
 */
export declare function sanitizeError(err: unknown): string;
/**
 * Sanitize a string by removing sensitive data
 */
export declare function sanitizeString(str: string): string;
/**
 * Sanitize an object by redacting sensitive fields
 */
export declare function sanitizeObject<T extends Record<string, unknown>>(obj: T): T;
/**
 * Truncate a string to a maximum length
 */
export declare function truncate(str: string, maxLength: number, suffix?: string): string;
/**
 * Mask a token for logging (show first and last few characters)
 */
export declare function maskToken(token: string, visibleChars?: number): string;
/**
 * Create a safe preview of a response body for logging
 */
export declare function createResponsePreview(body: string, maxLength?: number): string;
/**
 * Sanitize stack trace by removing file paths that might expose system info
 */
export declare function sanitizeStackTrace(stack: string | undefined): string | undefined;
//# sourceMappingURL=sanitizers.d.ts.map