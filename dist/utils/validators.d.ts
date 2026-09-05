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
 * Clamp a device-reported level into the range a characteristic advertises.
 *
 * Leviton reports levels against its own floor and ceiling, which do not always
 * agree with the props HomeKit was given — a device reporting 100 against a
 * maxLevel of 80 makes HAP reject the value and log it on every update. A
 * non-finite reading falls back to the low bound rather than reaching HomeKit.
 */
export declare function clampLevel(value: unknown, min: number, max: number): number;
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