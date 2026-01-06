"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceModel = void 0;
/**
 * Device model identifiers
 */
var DeviceModel;
(function (DeviceModel) {
    // Fan Controllers
    DeviceModel["FAN"] = "DW4SF";
    DeviceModel["FAN_GEN2"] = "D24SF";
    // Dimmers
    DeviceModel["DIMMER_VOICE"] = "DWVAA";
    DeviceModel["DIMMER_1000W"] = "DW1KD";
    DeviceModel["DIMMER_600W"] = "DW6HD";
    DeviceModel["DIMMER_600W_GEN2"] = "D26HD";
    DeviceModel["DIMMER_PLUGIN_GEN2"] = "D23LP";
    DeviceModel["DIMMER_PLUGIN"] = "DW3HL";
    DeviceModel["DIMMER_ELV"] = "D2ELV";
    DeviceModel["DIMMER_0_10V"] = "D2710";
    // Motion Sensor Dimmers
    DeviceModel["DIMMER_MOTION"] = "D2MSD";
    // Outlets
    DeviceModel["OUTLET_TAMPER"] = "DW15R";
    DeviceModel["OUTLET_PLUGIN_HP"] = "DW15A";
    DeviceModel["OUTLET_PLUGIN"] = "DW15P";
    DeviceModel["OUTLET_OUTDOOR"] = "D215O";
    // Switches
    DeviceModel["SWITCH_15A"] = "DW15S";
    DeviceModel["SWITCH_15A_GEN2"] = "D215S";
})(DeviceModel || (exports.DeviceModel = DeviceModel = {}));
//# sourceMappingURL=index.js.map