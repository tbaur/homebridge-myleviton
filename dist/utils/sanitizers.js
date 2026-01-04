"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Data sanitization utilities for security
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeError = sanitizeError;
exports.sanitizeString = sanitizeString;
exports.sanitizeObject = sanitizeObject;
exports.truncate = truncate;
exports.maskToken = maskToken;
exports.createResponsePreview = createResponsePreview;
exports.sanitizeStackTrace = sanitizeStackTrace;
/**
 * Patterns for sensitive data that should be redacted
 */
const SENSITIVE_PATTERNS = [
    { pattern: /password[=:]\s*\S+/gi, replacement: 'password=***' },
    { pattern: /token[=:]\s*\S+/gi, replacement: 'token=***' },
    { pattern: /email[=:]\s*\S+/gi, replacement: 'email=***' },
    { pattern: /authorization[=:]\s*\S+/gi, replacement: 'Authorization=***' },
    { pattern: /bearer\s+\S+/gi, replacement: 'Bearer ***' },
    { pattern: /"password"\s*:\s*"[^"]+"/gi, replacement: '"password":"***"' },
    { pattern: /"token"\s*:\s*"[^"]+"/gi, replacement: '"token":"***"' },
    { pattern: /"id"\s*:\s*"[a-zA-Z0-9]{20,}"/gi, replacement: '"id":"***"' },
];
/**
 * Sanitize error messages to prevent exposing sensitive data
 */
function sanitizeError(err) {
    let message;
    if (err instanceof Error) {
        message = err.message;
    }
    else if (typeof err === 'string') {
        message = err;
    }
    else {
        message = String(err);
    }
    return sanitizeString(message);
}
/**
 * Sanitize a string by removing sensitive data
 */
function sanitizeString(str) {
    let result = str;
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
        result = result.replace(pattern, replacement);
    }
    return result;
}
/**
 * Sanitize an object by redacting sensitive fields
 */
function sanitizeObject(obj) {
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
    ]);
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (sensitiveKeys.has(key.toLowerCase())) {
            result[key] = '***';
        }
        else if (typeof value === 'object' && value !== null) {
            result[key] = sanitizeObject(value);
        }
        else if (typeof value === 'string') {
            result[key] = sanitizeString(value);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
/**
 * Truncate a string to a maximum length
 */
function truncate(str, maxLength, suffix = '...') {
    if (str.length <= maxLength) {
        return str;
    }
    return str.substring(0, maxLength - suffix.length) + suffix;
}
/**
 * Mask a token for logging (show first and last few characters)
 */
function maskToken(token, visibleChars = 4) {
    if (token.length <= visibleChars * 2) {
        return '***';
    }
    return `${token.substring(0, visibleChars)}...${token.substring(token.length - visibleChars)}`;
}
/**
 * Create a safe preview of a response body for logging
 */
function createResponsePreview(body, maxLength = 200) {
    const sanitized = sanitizeString(body);
    return truncate(sanitized, maxLength);
}
/**
 * Sanitize stack trace by removing file paths that might expose system info
 */
function sanitizeStackTrace(stack) {
    if (!stack) {
        return undefined;
    }
    // Remove absolute paths, keep relative
    return stack.replace(/\s+at\s+.*\((\/[^)]+)\)/g, (match, path) => {
        const filename = path.split('/').pop() || path;
        return match.replace(path, filename);
    });
}
//# sourceMappingURL=sanitizers.js.map