/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Device state persistence for faster startup and offline resilience
 */

import * as fs from 'fs'
import * as path from 'path'
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
  private readonly storagePath: string
  private readonly maxAge: number
  private readonly maxDevices: number

  private deviceStates: Map<string, PersistedDeviceState> = new Map()
  private loaded = false
  private dirty = false

  constructor(storagePath?: string, config: Partial<PersistenceConfig> = {}) {
    const merged = { ...DEFAULT_PERSISTENCE_CONFIG, ...config }
    this.storagePath = storagePath || path.join(
      process.env.HOME || '/tmp',
      PERSISTENCE_FILE_NAME,
    )
    this.maxAge = merged.maxAge ?? 24 * 60 * 60 * 1000
    this.maxDevices = merged.maxDevices ?? 200
  }

  /**
   * Load persisted device states from disk
   */
  load(): Map<string, PersistedDeviceState> {
    if (this.loaded) {
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
    } catch {
      // Ignore load errors - start fresh
      this.deviceStates.clear()
    }

    this.loaded = true
    return this.deviceStates
  }

  /**
   * Save device states to disk
   */
  save(): boolean {
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

      // Write atomically using temp file
      const tempPath = `${this.storagePath}.tmp`
      fs.writeFileSync(tempPath, data, 'utf8')
      fs.renameSync(tempPath, this.storagePath)

      this.dirty = false
      return true
    } catch {
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
    storagePath: string
  } {
    return {
      deviceCount: this.size,
      loaded: this.loaded,
      dirty: this.dirty,
      storagePath: this.storagePath,
    }
  }
}

/**
 * Global persistence instance
 */
let globalPersistence: DevicePersistence | null = null

/**
 * Get or create the global persistence instance
 */
export function getDevicePersistence(storagePath?: string): DevicePersistence {
  if (!globalPersistence) {
    globalPersistence = new DevicePersistence(storagePath)
  }
  return globalPersistence
}

/**
 * Reset the global persistence (for testing)
 */
export function resetGlobalPersistence(): void {
  globalPersistence = null
}

