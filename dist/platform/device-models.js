"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Leviton device model registry (single source of truth)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_KNOWN_MODELS = exports.FAN_MODELS = exports.CONTROLLER_MODELS = exports.SWITCH_MODELS = exports.OUTLET_MODELS = exports.MOTION_DIMMER_MODELS = exports.DIMMER_MODELS = void 0;
exports.isStatelessControllerModel = isStatelessControllerModel;
exports.deviceTypeForModel = deviceTypeForModel;
exports.DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL', 'D2ELV', 'D2710', 'DN6HD'];
exports.MOTION_DIMMER_MODELS = ['D2MSD'];
exports.OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P', 'D215O'];
exports.SWITCH_MODELS = ['DW15S', 'D215S'];
/** Button controllers — discovered but not exposed as controllable HomeKit devices. */
exports.CONTROLLER_MODELS = ['DW4BC'];
exports.FAN_MODELS = ['DW4SF', 'D24SF'];
/** All known models for documentation and validation helpers. */
exports.ALL_KNOWN_MODELS = [
    ...exports.DIMMER_MODELS,
    ...exports.MOTION_DIMMER_MODELS,
    ...exports.OUTLET_MODELS,
    ...exports.SWITCH_MODELS,
    ...exports.CONTROLLER_MODELS,
    ...exports.FAN_MODELS,
];
/** True for button controllers and other devices with no controllable on/off state. */
function isStatelessControllerModel(model) {
    return exports.CONTROLLER_MODELS.includes((model || '').toUpperCase());
}
/**
 * Maps a device model to its HomeKit-facing type for diagnostics gauges.
 * Returns null for stateless controllers (which are not exposed). Unknown
 * models default to `switch`, mirroring setupService's fallback.
 */
function deviceTypeForModel(model) {
    const upper = model.toUpperCase();
    if (exports.CONTROLLER_MODELS.includes(upper)) {
        return null;
    }
    if (exports.FAN_MODELS.includes(upper)) {
        return 'fan';
    }
    if (exports.MOTION_DIMMER_MODELS.includes(upper)) {
        return 'motionDimmer';
    }
    if (exports.DIMMER_MODELS.includes(upper)) {
        return 'dimmer';
    }
    if (exports.OUTLET_MODELS.includes(upper)) {
        return 'outlet';
    }
    return 'switch';
}
//# sourceMappingURL=device-models.js.map