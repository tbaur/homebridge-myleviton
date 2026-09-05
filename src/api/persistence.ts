/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Device state persistence for faster startup and offline resilience
 */

import * as fs from 'fs'
import { sanitizeError } from '../utils/sanitizers'
import type { PersistedDeviceState, PersistenceFile, DeviceStatus } from '../types'

/**
 * Persistence configuration
 */
export interface PersistenceConfig {
  /** Storage file path */
  storagePath: string
  /** Maximum age of cached data in ms */
  maxAge: number
  /** Maximum number of devices to persist */
  maxDevices: number
  /** Optional warning callback for load/save failures */
  onWarn?: (message: string) => void
}

/**
 * Default persistence configuration
 */
export const DEFAULT_PERSISTENCE_CONFIG: Partial<PersistenceConfig> = {
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  maxDevices: 200,
}

/**
 * Default persistence file name
 */
export const PERSISTENCE_FILE_NAME = '.homebridge-myleviton-state.json'

/**
 * Device state persistence manager
 * Stores device states for faster startup and offline resilience
 */
export class DevicePersistence {
  /** Undefined when Homebridge gave us no storage directory; see the constructor. */
  private readonly storagePath: string | undefined
  private readonly maxAge: number
  private readonly maxDevices: number
  private readonly onWarn?: (message: string) => void

  private deviceStates: Map<string, PersistedDeviceState> = new Map()
  private loaded = false
  private dirty = false

  /**
   * @param storagePath Absolute path inside the Homebridge storage directory.
   *   When omitted, persistence is disabled rather than relocated: Homebridge
   *   requires plugin files to live under its storage directory, and the old
   *   fallback to `$HOME` or `/tmp` put a world-writable path in the load path,
   *   where another local user could pre-create the file we parse at boot.
   *   The in-memory cache still works for the life of the process.
   */
  constructor(storagePath?: string, config: Partial<PersistenceConfig> = {}) {
    const merged = { ...DEFAULT_PERSISTENCE_CONFIG, ...config }
    this.storagePath = storagePath
    this.maxAge = merged.maxAge ?? 24 * 60 * 60 * 1000
    this.maxDevices = merged.maxDevices ?? 200
    this.onWarn = merged.onWarn

    if (!this.storagePath) {
      this.onWarn?.(
        'Homebridge did not provide a storage directory, so device state will not persist '
        + 'across restarts. Caching still works for this session.',
      )
    }
  }

  /** True when state can actually be read from and written to disk. */
  get isEnabled(): boolean {
    return this.storagePath !== undefined
  }

  /**
   * Load persisted device states from disk
   */
  load(): Map<string, PersistedDeviceState> {
    if (this.loaded) {
      return this.deviceStates
    }

    if (!this.storagePath) {
      this.loaded = true
      return this.deviceStates
    }

    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf8')
        const parsed = JSON.parse(data) as PersistenceFile

        // Validate structure
        if (parsed && typeof parsed === 'object' && parsed.devices) {
          const now = Date.now()
          const maxAge = this.maxAge

          for (const [id, state] of Object.entries(parsed.devices)) {
            if (state && typeof state === 'object') {
              // Check if data is too old
              const cachedAt = parsed.timestamp || 0
              if (now - cachedAt < maxAge) {
                this.deviceStates.set(id, {
                  ...state,
                  _cached: true,
                  _cachedAt: cachedAt,
                })
              }
            }
          }
        }
      }
    } catch (err) {
      this.onWarn?.(`Failed to load device persistence from ${this.storagePath}: ${sanitizeError(err)}`)
      this.deviceStates.clear()
    }

    this.loaded = true
    return this.deviceStates
  }

  /**
   * Save device states to disk
   */
  save(): boolean {
    if (!this.storagePath) {
      return false
    }

    if (!this.dirty && this.loaded) {
      return true // Nothing to save
    }

    try {
      // Clean up internal properties before saving
      const devices: Record<string, Omit<PersistedDeviceState, '_cached' | '_cachedAt' | '_updatedAt'>> = {}

      // Limit size
      let count = 0
      for (const [id, state] of this.deviceStates.entries()) {
        if (count >= this.maxDevices) {break}

        const { _cached, _cachedAt, _updatedAt, ...cleanState } = state
        devices[id] = cleanState
        count++
      }

      const data = JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        devices,
      } as PersistenceFile, null, 2)

      // Write atomically using temp file. The mode is explicit because rename
      // carries it onto the live file, so the default umask would decide who
      // can read the device inventory.
      const tempPath = `${this.storagePath}.tmp`
      fs.writeFileSync(tempPath, data, { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(tempPath, this.storagePath)

      this.dirty = false
      return true
    } catch (err) {
      this.onWarn?.(`Failed to save device persistence to ${this.storagePath}: ${sanitizeError(err)}`)
      return false
    }
  }

  /**
   * Update state for a device
   */
  updateDevice(deviceId: string, state: Partial<PersistedDeviceState>): void {
    if (!deviceId) {return}

    const existing = this.deviceStates.get(deviceId) || { id: deviceId }

    this.deviceStates.set(deviceId, {
      ...existing,
      ...state,
      id: deviceId,
      _cached: false,
      _updatedAt: Date.now(),
    })

    this.dirty = true
  }

  /**
   * Update device from API status
   */
  updateFromStatus(deviceId: string, status: DeviceStatus): void {
    this.updateDevice(deviceId, {
      power: status.power,
      brightness: status.brightness,
    })
  }

  /**
   * Get cached state for a device
   */
  getDevice(deviceId: string): PersistedDeviceState | null {
    this.load() // Ensure loaded
    return this.deviceStates.get(deviceId) || null
  }

  /**
   * Check if device has fresh cached data
   */
  hasFreshCache(deviceId: string, maxAge = this.maxAge): boolean {
    const state = this.getDevice(deviceId)
    if (!state) {return false}

    const updatedAt = state._updatedAt || state._cachedAt || 0
    return Date.now() - updatedAt < maxAge
  }

  /**
   * Get device status from cache (for fallback)
   */
  getCachedStatus(deviceId: string): DeviceStatus | null {
    const state = this.getDevice(deviceId)
    if (!state || !state.power) {return null}

    return {
      id: state.id,
      power: state.power,
      brightness: state.brightness,
    }
  }

  /**
   * Remove a device from persistence
   */
  removeDevice(deviceId: string): boolean {
    const deleted = this.deviceStates.delete(deviceId)
    if (deleted) {
      this.dirty = true
    }
    return deleted
  }

  /**
   * Clear all persisted states
   */
  clear(): void {
    this.deviceStates.clear()
    this.dirty = true

    if (!this.storagePath) {
      return
    }

    try {
      if (fs.existsSync(this.storagePath)) {
        fs.unlinkSync(this.storagePath)
      }
    } catch {
      // Ignore delete errors
    }
  }

  /**
   * Get all cached device states
   */
  getAllDevices(): Map<string, PersistedDeviceState> {
    this.load()
    return new Map(this.deviceStates)
  }

  /**
   * Get device count
   */
  get size(): number {
    return this.deviceStates.size
  }

  /**
   * Check if persistence has been modified
   */
  get isDirty(): boolean {
    return this.dirty
  }

  /**
   * Get persistence statistics
   */
  getStats(): {
    deviceCount: number
    loaded: boolean
    dirty: boolean
    storagePath: string | undefined
    enabled: boolean
  } {
    return {
      deviceCount: this.size,
      loaded: this.loaded,
      dirty: this.dirty,
      storagePath: this.storagePath,
      enabled: this.isEnabled,
    }
  }
}

/**
 * Global persistence instance (test helper — production code should construct DevicePersistence directly).
 * @deprecated Prefer `new DevicePersistence()` per platform instance.
 */
let globalPersistence: DevicePersistence | null = null

/**
 * Get or create the global persistence instance
 * @deprecated Prefer constructing DevicePersistence per platform instance.
 */
export function getDevicePersistence(
  storagePath?: string,
  config: Partial<PersistenceConfig> = {},
): DevicePersistence {
  if (!globalPersistence) {
    globalPersistence = new DevicePersistence(storagePath, config)
  }
  return globalPersistence
}

/**
 * Reset the global persistence (for testing)
 */
export function resetGlobalPersistence(): void {
  globalPersistence = null
}

