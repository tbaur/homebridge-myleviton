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
 * Returns true if the supplied string already passes HAP-NodeJS Name validation.
 * Exposed primarily so callers can avoid redundant work on already-clean inputs.
 */
export declare function isValidHapName(name: string): boolean;
/**
 * Sanitize a HomeKit accessory/service name to satisfy Homebridge 2 / HAP-NodeJS
 * Name validation. Disallowed characters are replaced with a space so words stay
 * separated, then leading/trailing punctuation is trimmed.
 */
export declare function sanitizeHapName(name: string, fallback?: string): string;
/**
 * Sanitize an object by redacting sensitive fields. Nested objects and arrays
 * are handled recursively; arrays keep their array shape.
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