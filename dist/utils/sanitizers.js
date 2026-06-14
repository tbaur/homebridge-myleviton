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
exports.maskEmail = maskEmail;
exports.isValidHapName = isValidHapName;
exports.sanitizeHapName = sanitizeHapName;
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
    { pattern: /"id"\s*:\s*"[A-Za-z0-9._-]{20,}"/gi, replacement: '"id":"***"' },
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
 * Mask an email for logging (show first char and domain).
 */
function maskEmail(email) {
    const at = email.indexOf('@');
    if (at <= 0) {
        return '***';
    }
    return `${email[0]}***${email.slice(at)}`;
}
const HAP_NAME_MAX_LENGTH = 64;
// Mirrors HAP-NodeJS's allowed character set for the Name characteristic:
// https://github.com/homebridge/HAP-NodeJS/blob/master/src/lib/util/checkName.ts
// Allowed: Unicode letters/numbers, spaces, ASCII apostrophe, U+2019 (right single
// quotation mark), comma, period, and hyphen. The accessory must start and end
// with a letter, number, or U+2019.
const HAP_NAME_ALLOWED_INTERIOR = /[^\p{L}\p{N}\u2019 '.,-]+/gu;
const HAP_NAME_TRIM_BOUNDARY = /^[^\p{L}\p{N}\u2019]+|[^\p{L}\p{N}\u2019]+$/gu;
const HAP_NAME_VALID = /^[\p{L}\p{N}][\p{L}\p{N}\u2019 '.,-]*[\p{L}\p{N}\u2019]$/u;
/**
 * Returns true if the supplied string already passes HAP-NodeJS Name validation.
 * Exposed primarily so callers can avoid redundant work on already-clean inputs.
 */
function isValidHapName(name) {
    return typeof name === 'string' && HAP_NAME_VALID.test(name);
}
/**
 * Sanitize a HomeKit accessory/service name to satisfy Homebridge 2 / HAP-NodeJS
 * Name validation. Disallowed characters are replaced with a space so words stay
 * separated, then leading/trailing punctuation is trimmed.
 */
function sanitizeHapName(name, fallback = 'Leviton Device') {
    if (typeof name !== 'string' || name.length === 0) {
        return fallback;
    }
    if (isValidHapName(name) && name.length <= HAP_NAME_MAX_LENGTH) {
        return name;
    }
    const sanitized = name
        .replace(HAP_NAME_ALLOWED_INTERIOR, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(HAP_NAME_TRIM_BOUNDARY, '');
    const validName = sanitized || fallback;
    const truncated = validName.slice(0, HAP_NAME_MAX_LENGTH).trim();
    const trimmed = truncated.replace(HAP_NAME_TRIM_BOUNDARY, '');
    return trimmed || fallback;
}
const SENSITIVE_KEYS = new Set([
    'password',
    'token',
    'authorization',
    'secret',
    'apikey',
    'api_key',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
]);
/**
 * Recursively sanitize an arbitrary value, preserving arrays as arrays (so
 * structured log consumers can still treat them as lists) and redacting
 * sensitive object keys.
 */
function sanitizeValue(value) {
    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }
    if (typeof value === 'object' && value !== null) {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
            result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '***' : sanitizeValue(val);
        }
        return result;
    }
    if (typeof value === 'string') {
        return sanitizeString(value);
    }
    return value;
}
/**
 * Sanitize an object by redacting sensitive fields. Nested objects and arrays
 * are handled recursively; arrays keep their array shape.
 */
function sanitizeObject(obj) {
    return sanitizeValue(obj);
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