/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Leviton device model registry (single source of truth)
 */

import type { DeviceType } from '../types'

export const DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL', 'D2ELV', 'D2710', 'DN6HD']
export const MOTION_DIMMER_MODELS = ['D2MSD']
export const OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P', 'D215O']
export const SWITCH_MODELS = ['DW15S', 'D215S']
/** Button controllers — discovered but not exposed as controllable HomeKit devices. */
export const CONTROLLER_MODELS = ['DW4BC']
export const FAN_MODELS = ['DW4SF', 'D24SF']

/** All known models for documentation and validation helpers. */
export const ALL_KNOWN_MODELS = [
  ...DIMMER_MODELS,
  ...MOTION_DIMMER_MODELS,
  ...OUTLET_MODELS,
  ...SWITCH_MODELS,
  ...CONTROLLER_MODELS,
  ...FAN_MODELS,
]

/** True for button controllers and other devices with no controllable on/off state. */
export function isStatelessControllerModel(model: string | undefined): boolean {
  return CONTROLLER_MODELS.includes((model || '').toUpperCase())
}

/**
 * Maps a device model to its HomeKit-facing type for diagnostics gauges.
 * Returns null for stateless controllers (which are not exposed). Unknown
 * models default to `switch`, mirroring setupService's fallback.
 */
export function deviceTypeForModel(model: string): DeviceType | null {
  const upper = model.toUpperCase()
  if (CONTROLLER_MODELS.includes(upper)) {
    return null
  }
  if (FAN_MODELS.includes(upper)) {
    return 'fan'
  }
  if (MOTION_DIMMER_MODELS.includes(upper)) {
    return 'motionDimmer'
  }
  if (DIMMER_MODELS.includes(upper)) {
    return 'dimmer'
  }
  if (OUTLET_MODELS.includes(upper)) {
    return 'outlet'
  }
  return 'switch'
}
