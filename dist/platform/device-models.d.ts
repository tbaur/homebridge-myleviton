/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Leviton device model registry (single source of truth)
 */
import type { DeviceType } from '../types';
export declare const DIMMER_MODELS: string[];
export declare const MOTION_DIMMER_MODELS: string[];
export declare const OUTLET_MODELS: string[];
export declare const SWITCH_MODELS: string[];
/** Button controllers — discovered but not exposed as controllable HomeKit devices. */
export declare const CONTROLLER_MODELS: string[];
export declare const FAN_MODELS: string[];
/** All known models for documentation and validation helpers. */
export declare const ALL_KNOWN_MODELS: string[];
/** True for button controllers and other devices with no controllable on/off state. */
export declare function isStatelessControllerModel(model: string | undefined): boolean;
/**
 * Maps a device model to its HomeKit-facing type for diagnostics gauges.
 * Returns null for stateless controllers (which are not exposed). Unknown
 * models default to `switch`, mirroring setupService's fallback.
 */
export declare function deviceTypeForModel(model: string): DeviceType | null;
//# sourceMappingURL=device-models.d.ts.map