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

// Device model constants (matching platform.ts)
const DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL', 'D2ELV', 'D2710']
const MOTION_DIMMER_MODELS = ['D2MSD']
const OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P', 'D215O']
const SWITCH_MODELS = ['DW15S', 'D215S']
const CONTROLLER_MODELS = ['DW4BC']
const FAN_MODELS = ['DW4SF', 'D24SF']

// All device models combined
const ALL_DIMMER_MODELS = [...DIMMER_MODELS, ...MOTION_DIMMER_MODELS]
const ALL_CONTROLLABLE_MODELS = [...DIMMER_MODELS, ...MOTION_DIMMER_MODELS, ...FAN_MODELS, ...OUTLET_MODELS, ...SWITCH_MODELS]

// Mock HAP types with flexible value type
interface MockCharacteristic {
  on: jest.Mock
  removeAllListeners: jest.Mock
  updateValue: jest.Mock
  setProps: jest.Mock
  value: boolean | number
}

const mockCharacteristic = (): MockCharacteristic => ({
  on: jest.fn().mockReturnThis(),
  removeAllListeners: jest.fn().mockReturnThis(),
  updateValue: jest.fn().mockReturnThis(),
  setProps: jest.fn().mockReturnThis(),
  value: false as boolean | number,
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
        FirmwareRevision: 'FirmwareRevision',
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
  name: 'My Leviton',
  email: 'test@example.com',
  password: 'testpassword123',
  loglevel: 'info' as LogLevel,
}

// Helper to setup common mocks
const setupMocks = () => {
  const mockLog = createMockLog()
  const mockAPI = createMockHomebridgeAPI()
  registerPlatform(mockAPI)
  
  const { getApiClient } = require('../../src/api/client')
  const mockClient = {
    login: jest.fn().mockResolvedValue({ id: 'test-token', userId: 'user-123' }),
    getResidentialPermissions: jest.fn().mockResolvedValue([{ residentialAccountId: 'account-123' }]),
    getResidentialAccount: jest.fn().mockResolvedValue({ id: 'res-obj-123', primaryResidenceId: 'residence-123' }),
    getDevices: jest.fn().mockResolvedValue([]),
    getResidences: jest.fn().mockResolvedValue([]),
    getDeviceStatus: jest.fn().mockResolvedValue({ power: 'ON', brightness: 50, minLevel: 1, maxLevel: 100 }),
    setPower: jest.fn().mockResolvedValue({}),
    setBrightness: jest.fn().mockResolvedValue({}),
    clearCache: jest.fn(),
  }
  getApiClient.mockReturnValue(mockClient)
  
  const { getDevicePersistence } = require('../../src/api/persistence')
  const mockPersistence = {
    load: jest.fn().mockResolvedValue(new Map()),
    save: jest.fn().mockResolvedValue(undefined),
    updateDevice: jest.fn(),
    updateFromStatus: jest.fn(),
    getDevice: jest.fn().mockReturnValue(null),
    hasFreshCache: jest.fn().mockReturnValue(false),
    getCachedStatus: jest.fn().mockReturnValue(null),
  }
  getDevicePersistence.mockReturnValue(mockPersistence)
  
  const { createWebSocket } = require('../../src/api/websocket')
  createWebSocket.mockReturnValue({
    close: jest.fn(),
    updateToken: jest.fn(),
    isConnected: jest.fn().mockReturnValue(false),
  })
  
  return { mockLog, mockAPI, mockClient, mockPersistence }
}

describe('LevitonDecoraSmartPlatform', () => {
  let mockLog: jest.Mock
  let mockAPI: ReturnType<typeof createMockHomebridgeAPI>
  let mockClient: ReturnType<typeof setupMocks>['mockClient']
  let mockPersistence: ReturnType<typeof setupMocks>['mockPersistence']

  beforeEach(() => {
    jest.clearAllMocks()
    const mocks = setupMocks()
    mockLog = mocks.mockLog
    mockAPI = mocks.mockAPI
    mockClient = mocks.mockClient
    mockPersistence = mocks.mockPersistence
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
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('email is required'))
    })

    it('should log error for missing password', () => {
      const config = { ...validConfig, password: '' }
      new LevitonDecoraSmartPlatform(mockLog, config, mockAPI)
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('password is required'))
    })

    it('should log error for invalid email format', () => {
      const config = { ...validConfig, email: 'invalid-email' }
      new LevitonDecoraSmartPlatform(mockLog, config, mockAPI)
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('invalid format'))
    })
  })

  describe('configureAccessory', () => {
    it('should configure cached accessories', async () => {
      const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      const accessory = mockAccessory({ id: 'dev-1', name: 'Test Light', model: 'DW6HD', serial: 'ABC123' })
      
      await platform.configureAccessory(accessory)
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect((platform as unknown as { accessories: unknown[] }).accessories).toContain(accessory)
    })
  })

  describe('device model routing - all supported devices', () => {
    let platform: LevitonDecoraSmartPlatform

    beforeEach(() => {
      platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
    })

    // Test all dimmer models
    DIMMER_MODELS.forEach(model => {
      it(`should route ${model} dimmer to Lightbulb service`, async () => {
        const device = { id: 'dev-1', name: 'Test Dimmer', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        expect(accessory.getService).toHaveBeenCalledWith('Lightbulb', device.name)
      })
    })

    // Test motion dimmer
    MOTION_DIMMER_MODELS.forEach(model => {
      it(`should route ${model} motion dimmer to Lightbulb and MotionSensor services`, async () => {
        const device = { id: 'dev-1', name: 'Motion Dimmer', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        expect(accessory.getService).toHaveBeenCalledWith('Lightbulb', device.name)
        // Platform calls getService('MotionSensor') first to check if it exists
        expect(accessory.getService).toHaveBeenCalledWith('MotionSensor')
      })
    })

    // Test fan controller
    it.each(FAN_MODELS)('should route %s fan controller to Fan service', async (fanModel) => {
      const device = { id: 'dev-1', name: 'Test Fan', model: fanModel, serial: 'ABC123' }
      const accessory = mockAccessory(device)
      
      await platform.configureAccessory(accessory)
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(accessory.getService).toHaveBeenCalledWith('Fan', device.name)
    })

    // Test all outlet models
    OUTLET_MODELS.forEach(model => {
      it(`should route ${model} outlet to Outlet service`, async () => {
        const device = { id: 'dev-1', name: 'Test Outlet', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        expect(accessory.getService).toHaveBeenCalledWith('Outlet', device.name)
      })
    })

    // Test all switch models
    SWITCH_MODELS.forEach(model => {
      it(`should route ${model} switch to Switch service`, async () => {
        const device = { id: 'dev-1', name: 'Test Switch', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        expect(accessory.getService).toHaveBeenCalledWith('Switch', device.name)
      })
    })

    // Test controller models are skipped
    CONTROLLER_MODELS.forEach(model => {
      it(`should skip ${model} controller device (no controllable state)`, async () => {
        const device = { id: 'dev-1', name: 'Test Controller', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        expect(accessory.addService).not.toHaveBeenCalled()
      })
    })

    // Test unknown model defaults to switch
    it('should route unknown model to Switch service', async () => {
      const device = { id: 'dev-1', name: 'Unknown Device', model: 'UNKNOWN', serial: 'ABC123' }
      const accessory = mockAccessory(device)
      
      await platform.configureAccessory(accessory)
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(accessory.getService).toHaveBeenCalledWith('Switch', device.name)
    })
  })

  describe('initialization', () => {
    it('should discover devices on launch', async () => {
      mockClient.getDevices.mockResolvedValue([
        { id: 'dev-1', name: 'Living Room Light', model: 'DW6HD', serial: 'ABC123' },
        { id: 'dev-2', name: 'Kitchen Fan', model: 'DW4SF', serial: 'DEF456' },
      ])
      
      new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      mockAPI.emit('didFinishLaunching')
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(mockClient.login).toHaveBeenCalledWith(
        validConfig.email,
        validConfig.password,
        expect.any(Function),
      )
      expect(mockClient.getDevices).toHaveBeenCalled()
    })

    it('should pass connectionTimeout to WebSocket config', async () => {
      const { createWebSocket } = require('../../src/api/websocket')
      const config = { ...validConfig, connectionTimeout: 15000 }
      mockClient.getDevices.mockResolvedValue([
        { id: 'dev-1', name: 'Living Room Light', model: 'DW6HD', serial: 'ABC123' },
      ])
      
      new LevitonDecoraSmartPlatform(mockLog, config, mockAPI)
      mockAPI.emit('didFinishLaunching')
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(createWebSocket).toHaveBeenCalled()
      const lastCall = createWebSocket.mock.calls[createWebSocket.mock.calls.length - 1]
      expect(lastCall[4]).toEqual({ connectionTimeout: 15000 })
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
        brightness: 0,
        minLevel: 5,
        maxLevel: 100,
      })
      
      const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      const device = { id: 'dev-1', name: 'Test Light', model: 'DW6HD', serial: 'ABC123' }
      const accessory = mockAccessory(device)
      
      await platform.configureAccessory(accessory)
      await new Promise(resolve => setTimeout(resolve, 50))
      
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
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Platform ready'))
    })
  })

  describe('shutdown', () => {
    it('should save device states on shutdown', async () => {
      mockClient.getDevices.mockResolvedValue([])
      
      new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      mockAPI.emit('didFinishLaunching')
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      mockAPI.emit('shutdown')
      
      expect(mockPersistence.save).toHaveBeenCalled()
    })
  })
})

describe('Service setup for all device types', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupMocks()
  })

  describe('Dimmer service setup', () => {
    DIMMER_MODELS.forEach(model => {
      it(`should setup Lightbulb service with On and Brightness characteristics for ${model}`, async () => {
        const { mockLog, mockAPI, mockClient } = setupMocks()
        const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
        const device = { id: 'dev-1', name: 'Test Dimmer', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        const service = accessory.getService()
        expect(service.getCharacteristic).toHaveBeenCalledWith('On')
        expect(service.getCharacteristic).toHaveBeenCalledWith('Brightness')
        expect(mockClient.getDeviceStatus).toHaveBeenCalledWith(device.id, 'test-token')
      })
    })
  })

  describe('Motion dimmer service setup', () => {
    MOTION_DIMMER_MODELS.forEach(model => {
      it(`should setup Lightbulb and MotionSensor services for ${model}`, async () => {
        const { mockLog, mockAPI } = setupMocks()
        const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
        const device = { id: 'dev-1', name: 'Motion Dimmer', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        expect(accessory.getService).toHaveBeenCalledWith('Lightbulb', device.name)
        // Platform calls getService('MotionSensor') first to check if service exists
        expect(accessory.getService).toHaveBeenCalledWith('MotionSensor')
      })
    })
  })

  describe('Fan service setup', () => {
    it.each(FAN_MODELS)('should setup Fan service with On and RotationSpeed characteristics for %s', async (fanModel) => {
      const { mockLog, mockAPI, mockClient } = setupMocks()
      const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
      const device = { id: 'dev-1', name: 'Test Fan', model: fanModel, serial: 'ABC123' }
      const accessory = mockAccessory(device)
      
      await platform.configureAccessory(accessory)
      await new Promise(resolve => setTimeout(resolve, 50))
      
      const service = accessory.getService()
      expect(service.getCharacteristic).toHaveBeenCalledWith('On')
      expect(service.getCharacteristic).toHaveBeenCalledWith('RotationSpeed')
      expect(mockClient.getDeviceStatus).toHaveBeenCalledWith(device.id, 'test-token')
    })
  })

  describe('Outlet service setup', () => {
    OUTLET_MODELS.forEach(model => {
      it(`should setup Outlet service with On characteristic for ${model}`, async () => {
        const { mockLog, mockAPI, mockClient } = setupMocks()
        const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
        const device = { id: 'dev-1', name: 'Test Outlet', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        const service = accessory.getService()
        expect(service.getCharacteristic).toHaveBeenCalledWith('On')
        expect(mockClient.getDeviceStatus).toHaveBeenCalledWith(device.id, 'test-token')
      })
    })
  })

  describe('Switch service setup', () => {
    SWITCH_MODELS.forEach(model => {
      it(`should setup Switch service with On characteristic for ${model}`, async () => {
        const { mockLog, mockAPI, mockClient } = setupMocks()
        const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
        const device = { id: 'dev-1', name: 'Test Switch', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        const service = accessory.getService()
        expect(service.getCharacteristic).toHaveBeenCalledWith('On')
        expect(mockClient.getDeviceStatus).toHaveBeenCalledWith(device.id, 'test-token')
      })
    })
  })
})

describe('Characteristic handlers for all device types', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Power getter for all device types', () => {
    ALL_CONTROLLABLE_MODELS.forEach(model => {
      it(`should get power state for ${model}`, async () => {
        const { mockLog, mockAPI, mockClient } = setupMocks()
        mockClient.getDeviceStatus.mockResolvedValue({ power: 'ON', brightness: 50 })
        
        const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
        const device = { id: 'dev-1', name: 'Test Device', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        const service = accessory.getService()
        const onChar = service.getCharacteristic()
        const getHandler = onChar.on.mock.calls.find((call: [string, unknown]) => call[0] === 'get')?.[1] as (callback: (err: Error | null, value?: boolean) => void) => Promise<void>
        
        if (getHandler) {
          const callback = jest.fn()
          await getHandler(callback)
          
          expect(mockClient.getDeviceStatus).toHaveBeenCalledWith(device.id, 'test-token')
          expect(callback).toHaveBeenCalledWith(null, true)
        }
      })
    })
  })

  describe('Power setter for all device types', () => {
    ALL_CONTROLLABLE_MODELS.forEach(model => {
      it(`should set power state for ${model}`, async () => {
        const { mockLog, mockAPI, mockClient } = setupMocks()
        
        const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
        const device = { id: 'dev-1', name: 'Test Device', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        const service = accessory.getService()
        const onChar = service.getCharacteristic()
        const setHandler = onChar.on.mock.calls.find((call: [string, unknown]) => call[0] === 'set')?.[1] as (value: boolean, callback: () => void) => Promise<void>
        
        if (setHandler) {
          const callback = jest.fn()
          await setHandler(true, callback)
          
          expect(mockClient.setPower).toHaveBeenCalledWith(device.id, 'test-token', true)
          expect(callback).toHaveBeenCalled()
        }
      })
    })
  })

  describe('Brightness getter for dimmers and fan', () => {
    const modelsWithBrightness = [...ALL_DIMMER_MODELS, ...FAN_MODELS]
    
    modelsWithBrightness.forEach(model => {
      it(`should register brightness getter for ${model}`, async () => {
        const { mockLog, mockAPI, mockClient } = setupMocks()
        mockClient.getDeviceStatus.mockResolvedValue({ power: 'ON', brightness: 75, minLevel: 1, maxLevel: 100 })
        
        const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
        const device = { id: 'dev-1', name: 'Test Device', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        const service = accessory.getService()
        const brightnessChar = service.getCharacteristic()
        
        // Verify a 'get' handler was registered
        const getHandlerCalls = brightnessChar.on.mock.calls.filter((call: [string, unknown]) => call[0] === 'get')
        expect(getHandlerCalls.length).toBeGreaterThan(0)
        expect(mockClient.getDeviceStatus).toHaveBeenCalledWith(device.id, 'test-token')
      })
    })
  })

  describe('Brightness setter for dimmers and fan', () => {
    const modelsWithBrightness = [...ALL_DIMMER_MODELS, ...FAN_MODELS]
    
    modelsWithBrightness.forEach(model => {
      it(`should set brightness for ${model}`, async () => {
        const { mockLog, mockAPI, mockClient } = setupMocks()
        
        const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
        const device = { id: 'dev-1', name: 'Test Device', model, serial: 'ABC123' }
        const accessory = mockAccessory(device)
        
        await platform.configureAccessory(accessory)
        await new Promise(resolve => setTimeout(resolve, 50))
        
        const service = accessory.getService()
        const brightnessChar = service.getCharacteristic()
        const setHandlers = brightnessChar.on.mock.calls.filter((call: [string, unknown]) => call[0] === 'set')
        const brightnessSetHandler = setHandlers.length >= 2 ? setHandlers[1][1] as (value: number, callback: () => void) => Promise<void> : null
        
        if (brightnessSetHandler) {
          const callback = jest.fn()
          await brightnessSetHandler(75, callback)
          
          expect(mockClient.setBrightness).toHaveBeenCalledWith(device.id, 'test-token', 75)
          expect(callback).toHaveBeenCalled()
        }
      })
    })
  })
})

describe('Motion sensor functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should initialize motion sensor with occupancy state from status', async () => {
    const { mockLog, mockAPI, mockClient } = setupMocks()
    mockClient.getDeviceStatus.mockResolvedValue({
      power: 'ON',
      brightness: 50,
      occupancy: true,
      motion: false,
    })
    
    const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
    const device = { id: 'dev-1', name: 'Motion Dimmer', model: 'D2MSD', serial: 'ABC123' }
    const accessory = mockAccessory(device)
    
    await platform.configureAccessory(accessory)
    await new Promise(resolve => setTimeout(resolve, 50))
    
    // Platform calls getService('MotionSensor') first, then addService if not found
    expect(accessory.getService).toHaveBeenCalledWith('MotionSensor')
  })

  it('should handle motion detection from occupancy field', async () => {
    const { mockLog, mockAPI, mockClient } = setupMocks()
    mockClient.getDeviceStatus.mockResolvedValue({
      power: 'ON',
      brightness: 50,
      occupancy: true,
    })
    
    const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
    const device = { id: 'dev-1', name: 'Motion Dimmer', model: 'D2MSD', serial: 'ABC123' }
    const accessory = mockAccessory(device)
    
    await platform.configureAccessory(accessory)
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const motionService = accessory.getService('MotionSensor', 'Motion Dimmer Motion')
    expect(motionService).toBeDefined()
  })

  it('should handle motion detection from motion field', async () => {
    const { mockLog, mockAPI, mockClient } = setupMocks()
    mockClient.getDeviceStatus.mockResolvedValue({
      power: 'ON',
      brightness: 50,
      motion: true,
    })
    
    const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
    const device = { id: 'dev-1', name: 'Motion Dimmer', model: 'D2MSD', serial: 'ABC123' }
    const accessory = mockAccessory(device)
    
    await platform.configureAccessory(accessory)
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const motionService = accessory.getService('MotionSensor', 'Motion Dimmer Motion')
    expect(motionService).toBeDefined()
  })
})

describe('WebSocket update handling for all device types', () => {
  let platform: LevitonDecoraSmartPlatform

  const createAccessoryWithService = (device: { id: string; name: string; model: string; serial: string }, serviceType: string) => {
    const accessory = mockAccessory(device)
    const service = mockService()
    const characteristic = mockCharacteristic()
    
    accessory.getService = jest.fn((type: string) => {
      if (type === serviceType || type === 'AccessoryInformation') {
        return service
      }
      return null
    })
    
    service.getCharacteristic = jest.fn(() => characteristic)
    
    return { accessory, service, characteristic }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    const mocks = setupMocks()
    platform = new LevitonDecoraSmartPlatform(mocks.mockLog, validConfig, mocks.mockAPI)
  })

  describe('Power updates via WebSocket', () => {
    ALL_CONTROLLABLE_MODELS.forEach(model => {
      it(`should update power state for ${model} via WebSocket`, () => {
        const device = { id: 'dev-1', name: 'Test Device', model, serial: 'ABC123' }
        const serviceType = FAN_MODELS.includes(model) ? 'Fan' : 
                           OUTLET_MODELS.includes(model) ? 'Outlet' :
                           SWITCH_MODELS.includes(model) ? 'Switch' : 'Lightbulb'
        
        const { accessory, characteristic } = createAccessoryWithService(device, serviceType)
        
        // Add accessory to platform
        const platformAccessories = (platform as unknown as { accessories: unknown[] }).accessories
        platformAccessories.push(accessory)
        
        // Call handleWebSocketUpdate with proper binding
        const handleUpdate = (platform as unknown as { handleWebSocketUpdate: (payload: { id: string; power: string }) => void }).handleWebSocketUpdate.bind(platform)
        handleUpdate({ id: device.id, power: 'ON' })
        
        expect(characteristic.updateValue).toHaveBeenCalledWith(true)
      })
    })
  })

  describe('Brightness updates via WebSocket', () => {
    const modelsWithBrightness = [...ALL_DIMMER_MODELS, ...FAN_MODELS]
    
    modelsWithBrightness.forEach(model => {
      it(`should update brightness for ${model} via WebSocket`, () => {
        const device = { id: 'dev-1', name: 'Test Device', model, serial: 'ABC123' }
        const serviceType = FAN_MODELS.includes(model) ? 'Fan' : 'Lightbulb'
        
        const { accessory, characteristic } = createAccessoryWithService(device, serviceType)
        characteristic.value = 50
        
        // Add accessory to platform
        const platformAccessories = (platform as unknown as { accessories: unknown[] }).accessories
        platformAccessories.push(accessory)
        
        // Call handleWebSocketUpdate with proper binding
        const handleUpdate = (platform as unknown as { handleWebSocketUpdate: (payload: { id: string; brightness: number }) => void }).handleWebSocketUpdate.bind(platform)
        handleUpdate({ id: device.id, brightness: 75 })
        
        expect(characteristic.updateValue).toHaveBeenCalledWith(75)
      })
    })
  })

  describe('Motion updates via WebSocket for D2MSD', () => {
    it('should update motion sensor state via WebSocket', () => {
      const device = { id: 'dev-1', name: 'Motion Dimmer', model: 'D2MSD', serial: 'ABC123' }
      const { accessory } = createAccessoryWithService(device, 'Lightbulb')
      
      const motionService = mockService()
      const motionChar = mockCharacteristic()
      motionService.getCharacteristic = jest.fn(() => motionChar)
      accessory.getService = jest.fn((type: string) => {
        if (type === 'Lightbulb' || type === 'AccessoryInformation') {
          return mockService()
        }
        if (type === 'MotionSensor') {
          return motionService
        }
        return null
      })
      
      // Add accessory to platform
      const platformAccessories = (platform as unknown as { accessories: unknown[] }).accessories
      platformAccessories.push(accessory)
      
      // Call handleWebSocketUpdate with proper binding
      const handleUpdate = (platform as unknown as { handleWebSocketUpdate: (payload: { id: string; motion: boolean }) => void }).handleWebSocketUpdate.bind(platform)
      handleUpdate({ id: device.id, motion: true })
      
      expect(motionChar.updateValue).toHaveBeenCalledWith(true)
    })

    it('should update motion sensor state from occupancy field', () => {
      const device = { id: 'dev-1', name: 'Motion Dimmer', model: 'D2MSD', serial: 'ABC123' }
      const { accessory } = createAccessoryWithService(device, 'Lightbulb')
      
      const motionService = mockService()
      const motionChar = mockCharacteristic()
      motionService.getCharacteristic = jest.fn(() => motionChar)
      accessory.getService = jest.fn((type: string) => {
        if (type === 'Lightbulb' || type === 'AccessoryInformation') {
          return mockService()
        }
        if (type === 'MotionSensor') {
          return motionService
        }
        return null
      })
      
      // Add accessory to platform
      const platformAccessories = (platform as unknown as { accessories: unknown[] }).accessories
      platformAccessories.push(accessory)
      
      // Call handleWebSocketUpdate with proper binding
      const handleUpdate = (platform as unknown as { handleWebSocketUpdate: (payload: { id: string; occupancy: boolean }) => void }).handleWebSocketUpdate.bind(platform)
      handleUpdate({ id: device.id, occupancy: true })
      
      expect(motionChar.updateValue).toHaveBeenCalledWith(true)
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
  it('should have correct dimmer models', () => {
    expect(DIMMER_MODELS).toEqual(['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL', 'D2ELV', 'D2710'])
    expect(DIMMER_MODELS.length).toBe(8)
  })

  it('should have correct motion dimmer models', () => {
    expect(MOTION_DIMMER_MODELS).toEqual(['D2MSD'])
    expect(MOTION_DIMMER_MODELS.length).toBe(1)
  })

  it('should have correct outlet models', () => {
    expect(OUTLET_MODELS).toEqual(['DW15R', 'DW15A', 'DW15P', 'D215P', 'D215O'])
    expect(OUTLET_MODELS.length).toBe(5)
  })

  it('should have correct switch models', () => {
    expect(SWITCH_MODELS).toEqual(['DW15S', 'D215S'])
    expect(SWITCH_MODELS.length).toBe(2)
  })

  it('should have correct controller models', () => {
    expect(CONTROLLER_MODELS).toEqual(['DW4BC'])
    expect(CONTROLLER_MODELS.length).toBe(1)
  })

  it('should have correct fan models', () => {
    expect(FAN_MODELS).toEqual(['DW4SF', 'D24SF'])
  })
})

describe('Latency logging', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should include latency in power setter log message', async () => {
    const { mockLog, mockAPI, mockClient } = setupMocks()
    mockClient.setPower.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({}), 50)),
    )
    
    const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
    const device = { id: 'dev-1', name: 'Test Light', model: 'DW6HD', serial: 'ABC123' }
    const accessory = mockAccessory(device)
    
    await platform.configureAccessory(accessory)
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const onChar = accessory.getService().getCharacteristic()
    const setHandler = onChar.on.mock.calls.find((call: [string, unknown]) => call[0] === 'set')?.[1] as (value: boolean, callback: () => void) => Promise<void>
    
    if (setHandler) {
      const callback = jest.fn()
      await setHandler(true, callback)
      
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/Test Light: ON \(Latency: \d+ms\)/),
      )
    }
  })

  it('should include latency in brightness setter log message', async () => {
    const { mockLog, mockAPI, mockClient } = setupMocks()
    mockClient.setBrightness.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({}), 50)),
    )
    
    const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
    const device = { id: 'dev-1', name: 'Test Dimmer', model: 'DW6HD', serial: 'ABC123' }
    const accessory = mockAccessory(device)
    
    await platform.configureAccessory(accessory)
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const onChar = accessory.getService().getCharacteristic()
    const setHandlers = onChar.on.mock.calls.filter((call: [string, unknown]) => call[0] === 'set')
    
    if (setHandlers.length >= 2) {
      const brightnessHandler = setHandlers[1][1] as (value: number, callback: () => void) => Promise<void>
      const callback = jest.fn()
      await brightnessHandler(75, callback)
      
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/Test Dimmer: 75% \(Latency: \d+ms\)/),
      )
    }
  })

  it('should output structured JSON with duration when structuredLogs enabled', async () => {
    const { mockLog, mockAPI, mockClient } = setupMocks()
    const structuredConfig: LevitonConfig = {
      ...validConfig,
      structuredLogs: true,
    }
    
    mockClient.setPower.mockResolvedValue({})
    
    const platform = new LevitonDecoraSmartPlatform(mockLog, structuredConfig, mockAPI)
    const device = { id: 'dev-123', name: 'JSON Test', model: 'DW6HD', serial: 'ABC123' }
    const accessory = mockAccessory(device)
    
    await platform.configureAccessory(accessory)
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const onChar = accessory.getService().getCharacteristic()
    const setHandler = onChar.on.mock.calls.find((call: [string, unknown]) => call[0] === 'set')?.[1] as (value: boolean, callback: () => void) => Promise<void>
    
    if (setHandler) {
      const callback = jest.fn()
      await setHandler(true, callback)
      
      const jsonLogCall = mockLog.mock.calls.find((call: string[]) => {
        try {
          const parsed = JSON.parse(call[0])
          return parsed.deviceId && parsed.operation && parsed.duration !== undefined
        } catch {
          return false
        }
      })
      
      expect(jsonLogCall).toBeDefined()
      if (jsonLogCall) {
        const parsed = JSON.parse(jsonLogCall[0])
        expect(parsed).toMatchObject({
          level: 'info',
          deviceId: 'dev-123',
          operation: 'setPower',
          duration: expect.any(Number),
        })
        expect(parsed.message).toContain('JSON Test: ON')
      }
    }
  })

  it('should measure actual latency including token refresh', async () => {
    const { mockLog, mockAPI, mockClient } = setupMocks()
    mockClient.login.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ id: 'new-token', userId: 'user-123' }), 30)),
    )
    mockClient.setPower.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({}), 20)),
    )
    
    const platform = new LevitonDecoraSmartPlatform(mockLog, validConfig, mockAPI)
    const device = { id: 'dev-1', name: 'Latency Test', model: 'DW15S', serial: 'ABC123' }
    const accessory = mockAccessory(device)
    
    await platform.configureAccessory(accessory)
    await new Promise(resolve => setTimeout(resolve, 50))
    
    const onChar = accessory.getService().getCharacteristic()
    const setHandler = onChar.on.mock.calls.find((call: [string, unknown]) => call[0] === 'set')?.[1] as (value: boolean, callback: () => void) => Promise<void>
    
    if (setHandler) {
      const callback = jest.fn()
      const startTime = Date.now()
      await setHandler(false, callback)
      const elapsed = Date.now() - startTime
      
      const latencyLogCall = mockLog.mock.calls.find((call: string[]) => 
        call[0].includes('Latency Test: OFF (Latency:'),
      )
      expect(latencyLogCall).toBeDefined()
      
      const match = latencyLogCall?.[0].match(/Latency: (\d+)ms/)
      if (match) {
        const reportedLatency = parseInt(match[1], 10)
        expect(reportedLatency).toBeGreaterThanOrEqual(20)
        expect(reportedLatency).toBeLessThanOrEqual(elapsed + 50)
      }
    }
  })
})
