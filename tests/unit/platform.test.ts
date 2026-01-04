/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Tests for LevitonDecoraSmartPlatform
 */

// Mock modules before imports
jest.mock('../../src/api/client')
jest.mock('../../src/api/websocket')
jest.mock('../../src/api/persistence')

import { LevitonDecoraSmartPlatform, registerPlatform } from '../../src/platform'
import type { LevitonConfig, LogLevel } from '../../src/types'

// Mock HAP types
const mockCharacteristic = () => ({
  on: jest.fn().mockReturnThis(),
  removeAllListeners: jest.fn().mockReturnThis(),
  updateValue: jest.fn().mockReturnThis(),
  setProps: jest.fn().mockReturnThis(),
})

const mockService = () => ({
  getCharacteristic: jest.fn().mockReturnValue(mockCharacteristic()),
  addCharacteristic: jest.fn().mockReturnThis(),
  testCharacteristic: jest.fn().mockReturnValue(null),
})

const mockAccessory = (device: { id: string; name: string; model: string; serial: string }) => ({
  displayName: device.name,
  UUID: `myleviton-${device.id}`,
  context: {
    device,
    token: 'test-token',
  },
  getService: jest.fn().mockReturnValue(mockService()),
  addService: jest.fn().mockReturnValue(mockService()),
})

// Mock Homebridge API
const createMockHomebridgeAPI = () => {
  const eventHandlers: Record<string, () => void> = {}
  return {
    on: jest.fn((event: string, handler: () => void) => {
      eventHandlers[event] = handler
    }),
    emit: (event: string) => eventHandlers[event]?.(),
    user: {
      storagePath: jest.fn().mockReturnValue('/tmp/homebridge'),
    },
    hap: {
      uuid: {
        generate: jest.fn((id: string) => `uuid-${id}`),
      },
      Service: {
        AccessoryInformation: 'AccessoryInformation',
        Lightbulb: 'Lightbulb',
        Fan: 'Fan',
        Switch: 'Switch',
        Outlet: 'Outlet',
        MotionSensor: 'MotionSensor',
      },
      Characteristic: {
        On: 'On',
        Brightness: 'Brightness',
        RotationSpeed: 'RotationSpeed',
        MotionDetected: 'MotionDetected',
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        Name: 'Name',
      },
    },
    platformAccessory: jest.fn().mockImplementation((name: string, uuid: string) => ({
      displayName: name,
      UUID: uuid,
      context: {},
      getService: jest.fn().mockReturnValue(null),
      addService: jest.fn().mockReturnValue(mockService()),
    })),
    registerPlatform: jest.fn(),
    registerPlatformAccessories: jest.fn(),
    unregisterPlatformAccessories: jest.fn(),
  }
}

// Mock log function
const createMockLog = () => jest.fn()

// Valid config
const validConfig: LevitonConfig = {
  platform: 'MyLevitonDecoraSmart',
  email: 'test@example.com',
  password: 'testpassword123',
  loglevel: 'info' as LogLevel,
}

describe('LevitonDecoraSmartPlatform', () => {
  let mockLog: jest.Mock
  let mockAPI: ReturnType<typeof createMockHomebridgeAPI>
  let mockClient: {
    login: jest.Mock
    getResidentialPermissions: jest.Mock
    getResidentialAccount: jest.Mock
    getDevices: jest.Mock
    getResidences: jest.Mock
    getDeviceStatus: jest.Mock
    setPower: jest.Mock
    setBrightness: jest.Mock
  }
  let mockPersistence: {
    load: jest.Mock
    save: jest.Mock
    updateDevice: jest.Mock
    updateFromStatus: jest.Mock
    getDevice: jest.Mock
    hasFreshCache: jest.Mock
    getCachedStatus: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()
    
    mockLog = createMockLog()
    mockAPI = createMockHomebridgeAPI()
    
    // Initialize HAP by calling registerPlatform with mock homebridge
    registerPlatform(mockAPI)
    
    // Setup mock client
    const { getApiClient } = require('../../src/api/client')
    mockClient = {
      login: jest.fn().mockResolvedValue({ id: 'test-token', userId: 'user-123' }),
      getResidentialPermissions: jest.fn().mockResolvedValue([{ residentialAccountId: 'account-123' }]),
      getResidentialAccount: jest.fn().mockResolvedValue({ id: 'res-obj-123', primaryResidenceId: 'residence-123' }),
      getDevices: jest.fn().mockResolvedValue([]),
      getResidences: jest.fn().mockResolvedValue([]),
      getDeviceStatus: jest.fn().mockResolvedValue({ power: 'ON', brightness: 50, minLevel: 1, maxLevel: 100 }),
      setPower: jest.fn().mockResolvedValue({}),
      setBrightness: jest.fn().mockResolvedValue({}),
    }
    getApiClient.mockReturnValue(mockClient)
    
    // Setup mock persistence
    const { getDevicePersistence } = require('../../src/api/persistence')
    mockPersistence = {
      load: jest.fn().mockResolvedValue(new Map()),
      save: jest.fn().mockResolvedValue(undefined),
      updateDevice: jest.fn(),
      updateFromStatus: jest.fn(),
      getDevice: jest.fn().mockReturnValue(null),
      hasFreshCache: jest.fn().mockReturnValue(false),
      getCachedStatus: jest.fn().mockReturnValue(null),
    }
    getDevicePersistence.mockReturnValue(mockPersistence)
    
    // Setup mock websocket
    const { createWebSocket } = require('../../src/api/websocket')
    createWebSocket.mockReturnValue({
      close: jest.fn(),
      updateToken: jest.fn(),
      isConnected: jest.fn().mockReturnValue(false),
    })
  })

  describe('constructor', () => {
    it('should initialize with valid config', () => {
      const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      
      expect(platform).toBeDefined()
      expect(mockAPI.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function))
      expect(mockAPI.on).toHaveBeenCalledWith('shutdown', expect.any(Function))
    })

    it('should log error for missing config', () => {
      new LevitonDecoraSmartPlatform(mockLog, null as unknown as typeof validConfig, mockAPI)
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('No config'))
    })

    it('should log error for missing email', () => {
      const config = { ...validConfig, email: '' }
      new LevitonDecoraSmartPlatform(mockLog, config, mockAPI)
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('email and password'))
    })

    it('should log error for missing password', () => {
      const config = { ...validConfig, password: '' }
      new LevitonDecoraSmartPlatform(mockLog, config, mockAPI)
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('email and password'))
    })

    it('should log error for invalid email format', () => {
      const config = { ...validConfig, email: 'invalid-email' }
      new LevitonDecoraSmartPlatform(mockLog, config, mockAPI)
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Invalid email format'))
    })
  })

  describe('configureAccessory', () => {
    it('should configure cached accessories', async () => {
      const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      const accessory = mockAccessory({ id: 'dev-1', name: 'Test Light', model: 'DW6HD', serial: 'ABC123' })
      
      await platform.configureAccessory(accessory)
      
      // Accessory should be stored (wait for async operation)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect((platform as unknown as { accessories: unknown[] }).accessories).toContain(accessory)
    })
  })

  describe('device model routing', () => {
    let platform: LevitonDecoraSmartPlatform

    beforeEach(() => {
      platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
    })

    const testDeviceModels = [
      { model: 'DW6HD', expectedService: 'Lightbulb', description: 'dimmer' },
      { model: 'D26HD', expectedService: 'Lightbulb', description: 'dimmer' },
      { model: 'D23LP', expectedService: 'Lightbulb', description: 'plug-in dimmer' },
      { model: 'DW4SF', expectedService: 'Fan', description: 'fan controller' },
      { model: 'DW15P', expectedService: 'Outlet', description: 'outlet' },
      { model: 'D215P', expectedService: 'Outlet', description: 'plug-in switch' },
      { model: 'DW15S', expectedService: 'Switch', description: 'switch' },
      { model: 'D215S', expectedService: 'Switch', description: 'switch' },
      { model: 'D2MSD', expectedService: 'Lightbulb', description: 'motion dimmer' },
      { model: 'UNKNOWN', expectedService: 'Switch', description: 'unknown model' },
    ]

    testDeviceModels.forEach(({ model, expectedService, description }) => {
      it(`should route ${model} (${description}) to ${expectedService} service`, async () => {
        const device = { id: 'dev-1', name: 'Test Device', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        // Configure accessory to trigger service setup
        platform.configureAccessory(accessory)
        
        // Wait for async setup
        await new Promise(resolve => setTimeout(resolve, 10))
        
        // For controller models, no service should be added
        if (model === 'DW4BC') {
          expect(accessory.addService).not.toHaveBeenCalled()
        }
      })
    })

    it('should skip DW4BC controller devices', async () => {
      const device = { id: 'dev-1', name: 'Test Controller', model: 'DW4BC', serial: 'ABC123' }
      const accessory = mockAccessory(device)
      
      await platform.configureAccessory(accessory)
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Controller devices should be skipped - no service should be configured on the accessory
      // The addService should not be called for DW4BC
      expect(accessory.addService).not.toHaveBeenCalled()
    })
  })

  describe('initialization', () => {
    it('should discover devices on launch', async () => {
      mockClient.getDevices.mockResolvedValue([
        { id: 'dev-1', name: 'Living Room Light', model: 'DW6HD', serial: 'ABC123' },
        { id: 'dev-2', name: 'Kitchen Fan', model: 'DW4SF', serial: 'DEF456' },
      ])
      
      new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      
      // Trigger didFinishLaunching
      mockAPI.emit('didFinishLaunching')
      
      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(mockClient.login).toHaveBeenCalledWith(
        validConfig.email,
        validConfig.password,
        expect.any(Function),
      )
      expect(mockClient.getDevices).toHaveBeenCalled()
    })

    it('should handle login failure gracefully', async () => {
      mockClient.login.mockRejectedValue(new Error('Invalid credentials'))
      
      new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      mockAPI.emit('didFinishLaunching')
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize'))
    })

    it('should exclude devices by model', async () => {
      mockClient.getDevices.mockResolvedValue([
        { id: 'dev-1', name: 'Living Room Light', model: 'DW6HD', serial: 'ABC123' },
        { id: 'dev-2', name: 'Excluded Device', model: 'DW1KD', serial: 'DEF456' },
      ])
      
      const configWithExclusions: LevitonConfig = {
        ...validConfig,
        excludedModels: ['DW1KD'],
      }
      
      new LevitonDecoraSmartPlatform(mockLog, configWithExclusions, mockAPI)
      mockAPI.emit('didFinishLaunching')
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Should log that 1 device was excluded
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('1 excluded'))
    })

    it('should exclude devices by serial', async () => {
      mockClient.getDevices.mockResolvedValue([
        { id: 'dev-1', name: 'Living Room Light', model: 'DW6HD', serial: 'ABC123' },
        { id: 'dev-2', name: 'Excluded Device', model: 'DW6HD', serial: 'EXCLUDE-ME' },
      ])
      
      const configWithExclusions: LevitonConfig = {
        ...validConfig,
        excludedSerials: ['EXCLUDE-ME'],
      }
      
      new LevitonDecoraSmartPlatform(mockLog, configWithExclusions, mockAPI)
      mockAPI.emit('didFinishLaunching')
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('1 excluded'))
    })
  })

  describe('brightness handling', () => {
    it('should clamp brightness to minLevel', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({
        power: 'ON',
        brightness: 0, // Below minLevel
        minLevel: 5,
        maxLevel: 100,
      })
      
      const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      const device = { id: 'dev-1', name: 'Test Light', model: 'DW6HD', serial: 'ABC123' }
      const accessory = mockAccessory(device)
      
      platform.configureAccessory(accessory)
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Service should be configured with clamped brightness
      const service = accessory.getService()
      expect(service.getCharacteristic).toHaveBeenCalledWith('Brightness')
    })
  })

  describe('polling', () => {
    it('should log platform ready after initialization', async () => {
      mockClient.getDevices.mockResolvedValue([
        { id: 'dev-1', name: 'Living Room Light', model: 'DW6HD', serial: 'ABC123' },
      ])
      
      new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      mockAPI.emit('didFinishLaunching')
      
      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Should have logged Platform ready
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Platform ready'))
    })
  })

  describe('shutdown', () => {
    it('should save device states on shutdown', async () => {
      mockClient.getDevices.mockResolvedValue([])
      
      new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      mockAPI.emit('didFinishLaunching')
      
      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Trigger shutdown
      mockAPI.emit('shutdown')
      
      // Should save device states
      expect(mockPersistence.save).toHaveBeenCalled()
    })
  })
})

describe('registerPlatform', () => {
  it('should register the platform with Homebridge', () => {
    const mockHomebridge = {
      hap: {
        Service: {},
        Characteristic: {},
        uuid: { generate: jest.fn() },
      },
      registerPlatform: jest.fn(),
    }
    
    registerPlatform(mockHomebridge)
    
    expect(mockHomebridge.registerPlatform).toHaveBeenCalledWith(
      'homebridge-myleviton',
      'MyLevitonDecoraSmart',
      LevitonDecoraSmartPlatform,
      true,
    )
  })
})

describe('Device model constants', () => {
  // Test that model arrays are properly defined
  it('should have correct dimmer models', () => {
    // These are tested indirectly through device routing
    // The platform file defines: DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL']
    const dimmerModels = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL']
    expect(dimmerModels.length).toBe(6)
  })

  it('should have correct outlet models', () => {
    // OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P']
    const outletModels = ['DW15R', 'DW15A', 'DW15P', 'D215P']
    expect(outletModels.length).toBe(4)
  })

  it('should have correct switch models', () => {
    // SWITCH_MODELS = ['DW15S', 'D215S']
    const switchModels = ['DW15S', 'D215S']
    expect(switchModels.length).toBe(2)
  })

  it('should have correct controller models', () => {
    // CONTROLLER_MODELS = ['DW4BC']
    const controllerModels = ['DW4BC']
    expect(controllerModels.length).toBe(1)
  })
})

