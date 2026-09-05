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

import type {
  API,
  Characteristic,
  CharacteristicProps,
  HAP,
  PlatformAccessory as HomebridgePlatformAccessory,
  Service,
  WithUUID,
} from 'homebridge'
import type { DeviceInfo } from './index'

/**
 * Accessory context stored on Homebridge platform accessories.
 *
 * Declared as a type alias rather than an interface so it satisfies
 * Homebridge's `UnknownContext` constraint, which requires an index signature.
 */
export type AccessoryContextShape = {
  device?: DeviceInfo
  connectivity?: boolean
  /** @deprecated Legacy field scrubbed on load — never persisted by current versions. */
  token?: string
}

/** Range a characteristic advertises to HomeKit, as set by `setProps`. */
export type HAPCharacteristicProps = CharacteristicProps

/** HomeKit characteristic handle. */
export type HAPCharacteristic = Characteristic

/** HomeKit service handle. */
export type HAPService = Service

/** Cached Homebridge platform accessory, carrying this plugin's context. */
export type PlatformAccessory = HomebridgePlatformAccessory<AccessoryContextShape>

/** Homebridge API object passed to platform constructors. */
export type HomebridgeAPI = API

/** HAP-NodeJS module handed to plugins as `api.hap`. */
export type HAPModule = HAP

/** HAP-NodeJS Characteristic registry, i.e. the static side of the class. */
export type HAPCharacteristicRegistry = HAP['Characteristic']

/**
 * A service or characteristic identified the way Homebridge identifies one: by
 * its constructor off the `api.hap` registry.
 *
 * Both are derived from the registry rather than written out, so they track
 * whatever Homebridge actually exposes. The static form is deliberate — it is
 * the shape `testCharacteristic` requires, and it is accepted everywhere the
 * looser instance-constructor form is.
 */
export type ServiceRef =
  WithUUID<HAP['Service']> & (new (displayName?: string, subtype?: string) => Service)

/**
 * A characteristic constructor off `api.hap.Characteristic`, such as Brightness.
 *
 * HAP's own accessors disagree on the shape they want — `testCharacteristic`
 * takes the static side, `getCharacteristic` takes a zero-argument constructor —
 * so this intersects both. Every concrete registry entry satisfies both; only
 * the abstract base class does not.
 */
export type CharacteristicRef =
  WithUUID<HAPCharacteristicRegistry> & (new () => Characteristic)
