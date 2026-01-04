/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Input validation utilities
 */
import type { LevitonConfig, PowerState } from '../types';
/**
 * Validate email format
 */
export declare function validateEmail(email: unknown): string;
/**
 * Validate password
 */
export declare function validatePassword(password: unknown): string;
/**
 * Validate device ID
 * Accepts strings or numbers (Leviton API returns numeric IDs)
 */
export declare function validateDeviceId(id: unknown): string;
/**
 * Validate device serial
 */
export declare function validateSerial(serial: unknown): string;
/**
 * Validate authentication token
 */
export declare function validateToken(token: unknown): string;
/**
 * Validate power state
 */
export declare function validatePowerState(power: unknown): PowerState;
/**
 * Validate brightness value (0-100)
 */
export declare function validateBrightness(brightness: unknown): number;
/**
 * Validate plugin configuration
 */
export declare function validateConfig(config: unknown): LevitonConfig;
/**
 * Validate that a value is defined (not null or undefined)
 */
export declare function assertDefined<T>(value: T | null | undefined, name: string): T;
/**
 * Validate that a value is a non-empty array
 */
export declare function validateNonEmptyArray<T>(arr: unknown, name: string): T[];
//# sourceMappingURL=validators.d.ts.map