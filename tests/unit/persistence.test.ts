/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import * as fs from 'fs'
import { DevicePersistence, getDevicePersistence, resetGlobalPersistence } from '../../src/api/persistence'

// Mock fs module
jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>

describe('DevicePersistence', () => {
  const testPath = '/tmp/test-state.json'
  
  beforeEach(() => {
    resetGlobalPersistence()
    jest.clearAllMocks()
    
    // Default mock implementations
    mockFs.existsSync.mockReturnValue(false)
    mockFs.writeFileSync.mockImplementation(() => {})
    mockFs.renameSync.mockImplementation(() => {})
    mockFs.unlinkSync.mockImplementation(() => {})
  })

  describe('load', () => {
    it('should load devices from file', () => {
      const savedData = {
        version: 1,
        timestamp: Date.now(),
        devices: {
          'dev1': { id: 'dev1', name: 'Light 1', power: 'ON', brightness: 50 },
          'dev2': { id: 'dev2', name: 'Light 2', power: 'OFF' },
        },
      }
      
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(savedData))
      
      const persistence = new DevicePersistence(testPath)
      const devices = persistence.load()
      
      expect(devices.size).toBe(2)
      expect(devices.get('dev1')).toMatchObject({
        id: 'dev1',
        name: 'Light 1',
        power: 'ON',
        _cached: true,
      })
    })

    it('should return empty map if file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false)
      
      const persistence = new DevicePersistence(testPath)
      const devices = persistence.load()
      
      expect(devices.size).toBe(0)
    })

    it('should handle corrupted file gracefully', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('not valid json')
      
      const persistence = new DevicePersistence(testPath)
      const devices = persistence.load()
      
      expect(devices.size).toBe(0)
    })

    it('should expire old data', () => {
      const oldData = {
        version: 1,
        timestamp: Date.now() - 48 * 60 * 60 * 1000, // 48 hours ago
        devices: {
          'dev1': { id: 'dev1', power: 'ON' },
        },
      }
      
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(oldData))
      
      const persistence = new DevicePersistence(testPath, { maxAge: 24 * 60 * 60 * 1000 })
      const devices = persistence.load()
      
      expect(devices.size).toBe(0)
    })

    it('should only load once', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        devices: { 'dev1': { id: 'dev1' } },
      }))
      
      const persistence = new DevicePersistence(testPath)
      persistence.load()
      persistence.load()
      
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('save', () => {
    it('should save devices to file', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1', power: 'ON', brightness: 75 })
      persistence.updateDevice('dev2', { id: 'dev2', power: 'OFF' })
      
      const result = persistence.save()
      
      expect(result).toBe(true)
      expect(mockFs.writeFileSync).toHaveBeenCalled()
      expect(mockFs.renameSync).toHaveBeenCalled()
      
      // Check the written content
      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
      expect(writtenData.version).toBe(1)
      expect(writtenData.devices.dev1.power).toBe('ON')
      expect(writtenData.devices.dev1.brightness).toBe(75)
    })

    it('should not save if not dirty', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        devices: {},
      }))
      
      const persistence = new DevicePersistence(testPath)
      persistence.load()
      
      const result = persistence.save()
      
      expect(result).toBe(true)
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should limit number of saved devices', () => {
      const persistence = new DevicePersistence(testPath, { maxDevices: 2 })
      
      persistence.updateDevice('dev1', { id: 'dev1' })
      persistence.updateDevice('dev2', { id: 'dev2' })
      persistence.updateDevice('dev3', { id: 'dev3' })
      
      persistence.save()
      
      const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
      expect(Object.keys(writtenData.devices).length).toBe(2)
    })

    it('should handle write errors', () => {
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write failed')
      })
      
      const persistence = new DevicePersistence(testPath)
      persistence.updateDevice('dev1', { id: 'dev1' })
      
      const result = persistence.save()
      
      expect(result).toBe(false)
    })
  })

  describe('updateDevice', () => {
    it('should update existing device', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1', power: 'ON' })
      persistence.updateDevice('dev1', { power: 'OFF', brightness: 50 })
      
      const device = persistence.getDevice('dev1')
      
      expect(device?.power).toBe('OFF')
      expect(device?.brightness).toBe(50)
    })

    it('should mark as dirty', () => {
      const persistence = new DevicePersistence(testPath)
      
      expect(persistence.isDirty).toBe(false)
      
      persistence.updateDevice('dev1', { id: 'dev1' })
      
      expect(persistence.isDirty).toBe(true)
    })

    it('should ignore empty device ID', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('', { id: '' })
      
      expect(persistence.size).toBe(0)
    })
  })

  describe('updateFromStatus', () => {
    it('should update from API status', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateFromStatus('dev1', {
        power: 'ON',
        brightness: 75,
      })
      
      const device = persistence.getDevice('dev1')
      
      expect(device?.power).toBe('ON')
      expect(device?.brightness).toBe(75)
    })
  })

  describe('getDevice', () => {
    it('should return device if exists', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1', power: 'ON' })
      
      const device = persistence.getDevice('dev1')
      
      expect(device).not.toBeNull()
      expect(device?.power).toBe('ON')
    })

    it('should return null for missing device', () => {
      const persistence = new DevicePersistence(testPath)
      
      expect(persistence.getDevice('nonexistent')).toBeNull()
    })

    it('should trigger load if needed', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        version: 1,
        timestamp: Date.now(),
        devices: { 'dev1': { id: 'dev1' } },
      }))
      
      const persistence = new DevicePersistence(testPath)
      const device = persistence.getDevice('dev1')
      
      expect(mockFs.readFileSync).toHaveBeenCalled()
      expect(device).not.toBeNull()
    })
  })

  describe('hasFreshCache', () => {
    it('should return true for fresh data', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1' })
      
      expect(persistence.hasFreshCache('dev1', 60000)).toBe(true)
    })

    it('should return false for stale data', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        version: 1,
        timestamp: Date.now() - 10000, // 10 seconds ago
        devices: { 'dev1': { id: 'dev1' } },
      }))
      
      const persistence = new DevicePersistence(testPath)
      
      expect(persistence.hasFreshCache('dev1', 5000)).toBe(false) // 5 second max age
    })

    it('should return false for missing device', () => {
      const persistence = new DevicePersistence(testPath)
      
      expect(persistence.hasFreshCache('nonexistent')).toBe(false)
    })
  })

  describe('getCachedStatus', () => {
    it('should return status from cache', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1', power: 'ON', brightness: 50 })
      
      const status = persistence.getCachedStatus('dev1')
      
      expect(status).toEqual({
        id: 'dev1',
        power: 'ON',
        brightness: 50,
      })
    })

    it('should return null for device without power state', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1' })
      
      expect(persistence.getCachedStatus('dev1')).toBeNull()
    })
  })

  describe('removeDevice', () => {
    it('should remove device', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1' })
      expect(persistence.removeDevice('dev1')).toBe(true)
      expect(persistence.getDevice('dev1')).toBeNull()
    })

    it('should return false for missing device', () => {
      const persistence = new DevicePersistence(testPath)
      
      expect(persistence.removeDevice('nonexistent')).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear all devices and file', () => {
      mockFs.existsSync.mockReturnValue(true)
      
      const persistence = new DevicePersistence(testPath)
      persistence.updateDevice('dev1', { id: 'dev1' })
      
      persistence.clear()
      
      expect(persistence.size).toBe(0)
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(testPath)
    })
  })

  describe('getAllDevices', () => {
    it('should return all devices as map', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1' })
      persistence.updateDevice('dev2', { id: 'dev2' })
      
      const devices = persistence.getAllDevices()
      
      expect(devices.size).toBe(2)
      expect(devices.has('dev1')).toBe(true)
      expect(devices.has('dev2')).toBe(true)
    })
  })

  describe('getStats', () => {
    it('should return statistics', () => {
      const persistence = new DevicePersistence(testPath)
      
      persistence.updateDevice('dev1', { id: 'dev1' })
      
      const stats = persistence.getStats()
      
      expect(stats).toEqual({
        deviceCount: 1,
        loaded: false, // load() not explicitly called
        dirty: true,
        storagePath: testPath,
      })
    })
  })

  describe('global persistence', () => {
    it('should return same instance', () => {
      const p1 = getDevicePersistence(testPath)
      const p2 = getDevicePersistence(testPath)
      
      expect(p1).toBe(p2)
    })

    it('should reset properly', () => {
      const p1 = getDevicePersistence(testPath)
      resetGlobalPersistence()
      const p2 = getDevicePersistence(testPath)
      
      expect(p1).not.toBe(p2)
    })
  })
})

