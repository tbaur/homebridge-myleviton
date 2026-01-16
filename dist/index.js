"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Main entry point for homebridge-myleviton
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = exports.default = exports.LevitonDecoraSmartPlatform = void 0;
// Re-export everything
__exportStar(require("./types"), exports);
__exportStar(require("./errors"), exports);
__exportStar(require("./api"), exports);
__exportStar(require("./utils"), exports);
// Export platform
var platform_1 = require("./platform");
Object.defineProperty(exports, "LevitonDecoraSmartPlatform", { enumerable: true, get: function () { return platform_1.LevitonDecoraSmartPlatform; } });
// Default export for Homebridge plugin registration
var platform_2 = require("./platform");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return __importDefault(platform_2).default; } });
// Export version
exports.VERSION = '3.3.0';
//# sourceMappingURL=index.js.map