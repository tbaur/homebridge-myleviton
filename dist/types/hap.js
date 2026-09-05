"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge / HAP-NodeJS types used by the platform
 *
 * These are aliases onto the real `homebridge` typings rather than local
 * re-declarations. A hand-written surface cannot be checked against anything,
 * so it silently drifts: the previous version modelled a fourth parameter on
 * `registerPlatform` and a second on `getService` that Homebridge does not
 * accept, and both were being passed and discarded at runtime. Aliasing means
 * the compiler fails when Homebridge changes instead of when a user does.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=hap.js.map