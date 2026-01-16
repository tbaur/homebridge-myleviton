/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge platform plugin for My Leviton Decora Smart devices
 */

import * as path from 'path'
import { LevitonApiClient, getApiClient } from './api/client'
import { LevitonWebSocket, createWebSocket } from './api/websocket'
import { DevicePersistence, getDevicePersistence } from './api/persistence'
import { createStructuredLogger, StructuredLogger } from './utils/logger'
import { sanitizeError } from './utils/sanitizers'
import { validateConfig as validateConfigSchema } from './utils/validators'
import { AuthenticationError, ConfigurationError } from './errors'
import type {
  LevitonConfig,
  DeviceInfo,
  DeviceStatus,
  PowerState,
  WebSocketPayload,
  LoginResponse,
} from './types'

// Plugin constants
const PLUGIN_NAME = 'homebridge-myleviton'
const PLATFORM_NAME = 'MyLevitonDecoraSmart'
const UUID_PREFIX = 'myleviton-'

// Power states
const POWER_ON: PowerState = 'ON'
const POWER_OFF: PowerState = 'OFF'

// Token refresh buffer (refresh a few minutes before expiry)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

// Device model arrays for type checking
const DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL', 'D2ELV', 'D2710']
const MOTION_DIMMER_MODELS = ['D2MSD']
const OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P', 'D215O']  // D215P is plug-in switch, D215O is outdoor plug-in switch
const SWITCH_MODELS = ['DW15S', 'D215S']
const CONTROLLER_MODELS = ['DW4BC']  // Button controllers - no state, skip
const FAN_MODELS = ['DW4SF', 'D24SF']  // Fan speed controllers

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HAP = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HomebridgeAPI = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlatformAccessory = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Service = any

let hap: HAP

/**
 * Leviton Decora Smart Platform for Homebridge
 */
export class LevitonDecoraSmartPlatform {
  private readonly config: LevitonConfig
  private readonly api: HomebridgeAPI
  private readonly accessories: PlatformAccessory[] = []
  private readonly log: StructuredLogger
  
  // API client
  private client: LevitonApiClient
  
  // Token management
  private currentLoginResponse: LoginResponse | null = null
  private tokenExpiresAt: number | null = null
  private tokenRefreshPromise: Promise<LoginResponse> | null = null
  
  // WebSocket connection
  private webSocket: LevitonWebSocket | null = null
  
  // Polling
  private pollingInterval: ReturnType<typeof setInterval> | null = null
  private residenceId: string | null = null
  
  // Device persistence
  private devicePersistence: DevicePersistence
  
  // Cleanup interval
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    homebridgeLog: (msg: string) => void,
    config: LevitonConfig,
    api: HomebridgeAPI,
  ) {
    this.config = config
    this.api = api
    
    // Setup logging with optional structured JSON output
    this.log = createStructuredLogger(homebridgeLog, {
      structured: config?.structuredLogs || false,
      level: config?.loglevel || 'info',
    })
    
    // Setup API client
    this.client = getApiClient({
      timeout: config?.connectionTimeout || 10000,
    })
    
    // Setup device persistence
    const storagePath = api?.user?.storagePath?.() 
      ? path.join(api.user.storagePath(), '.homebridge-myleviton-state.json')
      : undefined
    this.devicePersistence = getDevicePersistence(storagePath)

    // Validate configuration
    if (!this.validateConfig()) {
      return
    }

    // Initialize on Homebridge launch
    api.on('didFinishLaunching', async () => {
      await this.initialize()
    })
    
    // Cleanup on shutdown
    api.on('shutdown', () => {
      this.saveDeviceStates()
      this.cleanup()
    })
    
    // Start periodic cleanup
    this.startPeriodicCleanup()
  }

  /**
   * Validates plugin configuration using comprehensive schema validation
   */
  private validateConfig(): boolean {
    if (!this.config) {
      this.log.error(`No config for ${PLUGIN_NAME} defined.`)
      return false
    }

    try {
      validateConfigSchema(this.config)
      return true
    } catch (err) {
      if (err instanceof ConfigurationError) {
        this.log.error(`Configuration error: ${err.message}`)
        if (err.details && err.details.length > 0) {
          err.details.forEach((detail: string) => this.log.error(`  - ${detail}`))
        }
      } else {
        this.log.error(`Invalid configuration: ${sanitizeError(err)}`)
      }
      return false
    }
  }

  /**
   * Initializes the platform
   */
  private async initialize(): Promise<void> {
    this.log.info('Starting My Leviton Decora Smart platform...')

    try {
      const { devices, loginResponse, residenceId } = await this.discoverDevices()
      
      this.setLoginResponse(loginResponse)
      this.residenceId = residenceId

      if (devices.length === 0) {
        this.log.error('No devices found in your My Leviton account')
        return
      }

      // Get exclusion lists
      const excludedModels = (this.config.excludedModels || []).map(m => m.toUpperCase())
      const excludedSerials = (this.config.excludedSerials || []).map(s => s.toUpperCase())

      let newDevices = 0
      let excludedCount = 0
      let cachedCount = 0

      for (const device of devices) {
        if (this.isDeviceExcluded(device, excludedModels, excludedSerials)) {
          excludedCount++
        } else if (this.accessoryExists(device)) {
          cachedCount++
        } else {
          await this.addAccessory(device, loginResponse.id)
          newDevices++
        }
      }

      this.log.info(`Found ${devices.length} devices (${cachedCount} cached, ${newDevices} new, ${excludedCount} excluded)`)
      
      // Start polling
      this.startPolling()
      
      this.log.info('Platform ready')
    } catch (error) {
      this.log.error(`Failed to initialize: ${sanitizeError(error)}`)
    }
  }

  /**
   * Discovers devices from Leviton API
   */
  private async discoverDevices(): Promise<{ devices: DeviceInfo[]; loginResponse: LoginResponse; residenceId: string }> {
    const debugLog = (msg: string) => this.log.debug(msg)
    
    // Login
    this.log.info('Connecting to My Leviton...')
    const loginResponse = await this.client.login(this.config.email, this.config.password, debugLog)
    const token = loginResponse.id
    const personId = loginResponse.userId
    
    this.log.info('Authentication successful')

    // Get residential permissions
    this.log.info('Loading residence information...')
    const permissions = await this.client.getResidentialPermissions(personId, token, debugLog)
    
    if (!permissions.length || !permissions[0].residentialAccountId) {
      throw new Error('No residential permissions found')
    }
    
    const accountId = permissions[0].residentialAccountId

    // Get residential account
    const account = await this.client.getResidentialAccount(accountId, token, debugLog)
    
    if (!account.primaryResidenceId || !account.id) {
      throw new Error('Invalid residential account response')
    }
    
    let residenceId = account.primaryResidenceId
    const residenceObjectId = account.id

    // Get devices
    this.log.info('Discovering devices...')
    let devices = await this.client.getDevices(residenceId, token, debugLog)

    // Try v2 API if no devices found
    if (!devices.length) {
      this.log.debug('Trying alternate residence API...')
      const residences = await this.client.getResidences(residenceObjectId, token, debugLog)
      
      if (residences.length && residences[0].id) {
        residenceId = residences[0].id
        devices = await this.client.getDevices(residenceId, token, debugLog)
      }
    }

    // Setup WebSocket for real-time updates
    try {
      this.webSocket = createWebSocket(
        loginResponse,
        devices,
        this.handleWebSocketUpdate.bind(this),
        {
          debug: (msg: string) => this.log.debug(msg),
          info: (msg: string) => this.log.info(msg),
          warn: (msg: string) => this.log.warn(msg),
          error: (msg: string) => this.log.error(msg),
        },
        this.config.connectionTimeout ? { connectionTimeout: this.config.connectionTimeout } : {},
      )
    } catch (err) {
      this.log.warn(`WebSocket unavailable: ${sanitizeError(err)}`)
    }

    return { devices, loginResponse, residenceId }
  }

  /**
   * Handles WebSocket update messages
   */
  private handleWebSocketUpdate(payload: WebSocketPayload): void {
    if (!payload?.id) {
      this.log.warn('Received invalid WebSocket payload')
      return
    }

    const accessory = this.accessories.find(
      acc => String(acc.context?.device?.id) === String(payload.id),
    )

    if (!accessory) {
      this.log.debug(`No accessory found for device ID: ${payload.id}`)
      return
    }

    const { id, power, brightness, occupancy, motion } = payload
    const device = accessory.context?.device

    this.log.debug(`WebSocket: ${accessory.displayName} (${id}): ${power} ${brightness ? `${brightness}%` : ''}`)

    // Get service
    const fanService = accessory.getService(hap.Service.Fan)
    const lightService = accessory.getService(hap.Service.Lightbulb)
    const switchService = accessory.getService(hap.Service.Switch)
    const outletService = accessory.getService(hap.Service.Outlet)

    const primaryService = fanService || lightService || switchService || outletService

    if (!primaryService) {
      this.log.warn(`No service found for accessory: ${accessory.displayName}`)
      return
    }

    // Get current state before updating
    const currentPower = primaryService.getCharacteristic(hap.Characteristic.On).value as boolean
    const currentPowerState = currentPower ? POWER_ON : POWER_OFF

    // Update brightness/rotation speed
    if (brightness !== undefined) {
      // Get current brightness for change detection
      let currentBrightness: number | undefined
      let newBrightness: number
      
      if (fanService) {
        // Fans allow 0 rotation speed
        newBrightness = Math.max(0, brightness)
        currentBrightness = fanService.getCharacteristic(hap.Characteristic.RotationSpeed).value as number
        fanService.getCharacteristic(hap.Characteristic.RotationSpeed).updateValue(newBrightness)
      } else if (lightService) {
        // Dimmers have minimum brightness of 1
        newBrightness = Math.max(1, brightness)
        currentBrightness = lightService.getCharacteristic(hap.Characteristic.Brightness).value as number
        lightService.getCharacteristic(hap.Characteristic.Brightness).updateValue(newBrightness)
      } else {
        return
      }
      
      // Log brightness change if different
      if (currentBrightness !== undefined && currentBrightness !== newBrightness) {
        this.log.info(`${accessory.displayName}: ${newBrightness}% (external)`, {
          deviceId: device?.id,
          operation: 'externalBrightnessUpdate',
          brightness: newBrightness,
        })
      }
    }

    // Update power state
    if (power !== undefined) {
      const newPowerBool = power === POWER_ON
      primaryService.getCharacteristic(hap.Characteristic.On).updateValue(newPowerBool)
      
      // Log power change if different
      if (currentPowerState !== power) {
        this.log.info(`${accessory.displayName}: ${power} (external)`, {
          deviceId: device?.id,
          operation: 'externalPowerUpdate',
          power,
        })
      }
    }

    // Update motion sensor
    const motionService = accessory.getService(hap.Service.MotionSensor)
    if (motionService && (occupancy !== undefined || motion !== undefined)) {
      const motionDetected = occupancy === true || motion === true
      motionService.getCharacteristic(hap.Characteristic.MotionDetected).updateValue(motionDetected)
    }
  }

  /**
   * Checks if device should be excluded
   */
  private isDeviceExcluded(device: DeviceInfo, excludedModels: string[], excludedSerials: string[]): boolean {
    if (!device?.model || !device?.serial) {
      return false
    }
    return excludedModels.includes(device.model.toUpperCase()) || 
           excludedSerials.includes(device.serial.toUpperCase())
  }

  /**
   * Checks if accessory already exists by serial number
   * Normalizes both values to strings for comparison (API may return different types)
   */
  private accessoryExists(device: DeviceInfo): boolean {
    const deviceSerial = String(device.serial || '').trim().toUpperCase()
    const match = this.accessories.find(acc => {
      const cachedSerial = String(acc.context?.device?.serial || '').trim().toUpperCase()
      return cachedSerial === deviceSerial
    })
    if (!match) {
      this.log.debug(`No cached accessory found for ${device.name} (serial: ${device.serial})`)
    }
    return !!match
  }

  /**
   * Adds a new accessory
   */
  async addAccessory(device: DeviceInfo, token: string): Promise<void> {
    if (!device?.serial || !device?.name) {
      this.log.error('Invalid device object provided to addAccessory')
      return
    }

    this.log.info(`Adding device: ${device.name} (${device.model})`)

    const uuid = hap.uuid.generate(UUID_PREFIX + device.serial)
    const accessory = new this.api.platformAccessory(device.name, uuid)

    accessory.context = { device, token }

    // Set device info
    const infoService = accessory.getService(hap.Service.AccessoryInformation)
    if (infoService) {
      infoService
        .setCharacteristic(hap.Characteristic.Name, device.name || 'Unknown Device')
        .setCharacteristic(hap.Characteristic.SerialNumber, device.serial || 'Unknown')
        .setCharacteristic(hap.Characteristic.Manufacturer, device.manufacturer || 'Leviton')
        .setCharacteristic(hap.Characteristic.Model, device.model || 'Unknown')
        .setCharacteristic(hap.Characteristic.FirmwareRevision, device.version || 'Unknown')
    }

    // Setup service
    await this.setupService(accessory)

    // Register with Homebridge
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
    this.accessories.push(accessory)
  }

  /**
   * Configures a cached accessory
   */
  async configureAccessory(accessory: PlatformAccessory): Promise<void> {
    this.log.debug(`Configuring cached accessory: ${accessory.displayName}`)
    await this.setupService(accessory)
    this.accessories.push(accessory)
  }

  /**
   * Sets up the appropriate service for a device
   */
  private async setupService(accessory: PlatformAccessory): Promise<void> {
    const device = accessory.context?.device

    if (!device) {
      this.log.error(`Missing device in accessory context: ${accessory.displayName}`)
      return
    }

    const model = device.model || ''

    // Button controllers don't have controllable state - skip them
    if (CONTROLLER_MODELS.includes(model)) {
      this.log.debug(`Skipping controller device: ${device.name} (${model})`)
      return
    }

    if (FAN_MODELS.includes(model)) {
      await this.setupFanService(accessory, device)
    } else if (MOTION_DIMMER_MODELS.includes(model)) {
      await this.setupMotionDimmerService(accessory, device)
    } else if (DIMMER_MODELS.includes(model)) {
      await this.setupLightbulbService(accessory, device)
    } else if (OUTLET_MODELS.includes(model)) {
      await this.setupBasicService(accessory, device, hap.Service.Outlet)
    } else if (SWITCH_MODELS.includes(model)) {
      await this.setupBasicService(accessory, device, hap.Service.Switch)
    } else {
      // Unknown model - treat as switch
      this.log.info(`Unknown device model '${model}' for ${device.name}, treating as switch`)
      await this.setupBasicService(accessory, device, hap.Service.Switch)
    }
  }

  /**
   * Gets device status with error handling
   */
  private async getStatus(device: DeviceInfo): Promise<DeviceStatus> {
    try {
      return await this.withTokenRetry(async () => {
        const token = await this.ensureValidToken()
        return this.client.getDeviceStatus(device.id, token)
      })
    } catch (err) {
      this.log.error(`Failed to get status for ${device.name}: ${sanitizeError(err)}`)
      return { power: POWER_OFF, brightness: 0, minLevel: 1, maxLevel: 100 }
    }
  }

  /**
   * Sets up a lightbulb service
   */
  private async setupLightbulbService(accessory: PlatformAccessory, device: DeviceInfo): Promise<void> {
    const status = await this.getStatus(device)
    const service = accessory.getService(hap.Service.Lightbulb, device.name) || 
                    accessory.addService(hap.Service.Lightbulb, device.name)

    // Calculate valid brightness range
    const minBrightness = status.minLevel || 1
    const maxBrightness = status.maxLevel || 100
    // Ensure brightness is within valid range (0 is invalid for HomeKit Brightness which has minValue=1)
    const rawBrightness = typeof status.brightness === 'number' ? status.brightness : 0
    const safeBrightness = rawBrightness < minBrightness ? minBrightness : rawBrightness

    // Setup On characteristic
    const onChar = service.getCharacteristic(hap.Characteristic.On)
    onChar.removeAllListeners('get')
    onChar.removeAllListeners('set')
    onChar.on('get', this.createPowerGetter(device))
    onChar.on('set', this.createPowerSetter(device))
    onChar.updateValue(status.power === POWER_ON)

    // Setup Brightness characteristic
    // Use getCharacteristic which always returns a valid Characteristic object
    const brightnessChar = service.getCharacteristic(hap.Characteristic.Brightness)
    // For cached accessories, update value to safe minimum BEFORE setting restrictive props
    // This prevents HAP validation error when cached value (e.g., 0) violates new minValue
    brightnessChar.updateValue(safeBrightness)
    brightnessChar.setProps({ minValue: minBrightness, maxValue: maxBrightness, minStep: 1 })
    brightnessChar.removeAllListeners('get')
    brightnessChar.removeAllListeners('set')
    brightnessChar.on('get', this.createBrightnessGetter(device, minBrightness))
    brightnessChar.on('set', this.createBrightnessSetter(device))
  }

  /**
   * Sets up a motion dimmer service
   */
  private async setupMotionDimmerService(accessory: PlatformAccessory, device: DeviceInfo): Promise<void> {
    await this.setupLightbulbService(accessory, device)
    
    const status = await this.getStatus(device)
    const motionService = accessory.getService(hap.Service.MotionSensor) ||
                          accessory.addService(hap.Service.MotionSensor, `${device.name} Motion`)
    
    motionService
      .getCharacteristic(hap.Characteristic.MotionDetected)
      .updateValue(status.occupancy === true || status.motion === true)
  }

  /**
   * Sets up a fan service
   */
  private async setupFanService(accessory: PlatformAccessory, device: DeviceInfo): Promise<void> {
    const status = await this.getStatus(device)
    const service = accessory.getService(hap.Service.Fan, device.name) ||
                    accessory.addService(hap.Service.Fan, device.name)

    // Setup On characteristic
    const onChar = service.getCharacteristic(hap.Characteristic.On)
    onChar.removeAllListeners('get')
    onChar.removeAllListeners('set')
    onChar.on('get', this.createPowerGetter(device))
    onChar.on('set', this.createPowerSetter(device))
    onChar.updateValue(status.power === POWER_ON)

    // Setup RotationSpeed characteristic - set props before value
    const speedChar = service.getCharacteristic(hap.Characteristic.RotationSpeed)
    speedChar.setProps({ minValue: 0, maxValue: status.maxLevel || 100, minStep: status.minLevel || 1 })
    speedChar.removeAllListeners('get')
    speedChar.removeAllListeners('set')
    speedChar.on('get', this.createBrightnessGetter(device, 0))  // Fans allow 0
    speedChar.on('set', this.createBrightnessSetter(device))
    speedChar.updateValue(status.brightness || 0)
  }

  /**
   * Sets up a basic switch/outlet service
   */
  private async setupBasicService(
    accessory: PlatformAccessory, 
    device: DeviceInfo, 
    ServiceType: Service,
  ): Promise<void> {
    const status = await this.getStatus(device)
    const service = accessory.getService(ServiceType, device.name) ||
                    accessory.addService(ServiceType, device.name)

    // Remove existing listeners to prevent stacking on cached accessories
    const onChar = service.getCharacteristic(hap.Characteristic.On)
    onChar.removeAllListeners('get')
    onChar.removeAllListeners('set')
    onChar.on('get', this.createPowerGetter(device))
    onChar.on('set', this.createPowerSetter(device))
    onChar.updateValue(status.power === POWER_ON)
  }

  /**
   * Creates a power getter handler
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createPowerGetter(device: DeviceInfo): any {
    return async (callback: (err: Error | null, value?: boolean) => void) => {
      try {
        const status = await this.withTokenRetry(async () => {
          const token = await this.ensureValidToken()
          return this.client.getDeviceStatus(device.id, token)
        })
        callback(null, status.power === POWER_ON)
      } catch (err) {
        callback(new Error(sanitizeError(err)))
      }
    }
  }

  /**
   * Creates a power setter handler
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createPowerSetter(device: DeviceInfo): any {
    return async (value: boolean, callback: (err?: Error) => void) => {
      const startTime = Date.now()
      try {
        await this.withTokenRetry(async () => {
          const token = await this.ensureValidToken()
          await this.client.setPower(device.id, token, value)
        })
        const latency = Date.now() - startTime
        this.log.info(`${device.name}: ${value ? 'ON' : 'OFF'} (Latency: ${latency}ms)`, {
          deviceId: device.id,
          operation: 'setPower',
          duration: latency,
        })
        callback()
      } catch (err) {
        callback(new Error(sanitizeError(err)))
      }
    }
  }

  /**
   * Creates a brightness getter handler
   * @param device - Device info
   * @param minValue - Minimum brightness value (0 for fans, 1 for dimmers)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createBrightnessGetter(device: DeviceInfo, minValue = 1): any {
    return async (callback: (err: Error | null, value?: number) => void) => {
      try {
        const status = await this.withTokenRetry(async () => {
          const token = await this.ensureValidToken()
          return this.client.getDeviceStatus(device.id, token)
        })
        callback(null, Math.max(minValue, status.brightness ?? 0))
      } catch (err) {
        callback(new Error(sanitizeError(err)))
      }
    }
  }

  /**
   * Creates a brightness setter handler
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createBrightnessSetter(device: DeviceInfo): any {
    return async (value: number, callback: (err?: Error) => void) => {
      const startTime = Date.now()
      try {
        await this.withTokenRetry(async () => {
          const token = await this.ensureValidToken()
          await this.client.setBrightness(device.id, token, value)
        })
        const latency = Date.now() - startTime
        this.log.info(`${device.name}: ${value}% (Latency: ${latency}ms)`, {
          deviceId: device.id,
          operation: 'setBrightness',
          duration: latency,
        })
        callback()
      } catch (err) {
        callback(new Error(sanitizeError(err)))
      }
    }
  }

  /**
   * Store login response and compute token expiry
   */
  private setLoginResponse(loginResponse: LoginResponse): void {
    this.currentLoginResponse = loginResponse
    if (typeof loginResponse.ttl === 'number' && Number.isFinite(loginResponse.ttl)) {
      this.tokenExpiresAt = Date.now() + loginResponse.ttl * 1000
    } else {
      this.tokenExpiresAt = null
    }
  }

  /**
   * Check if the token is close to expiring
   */
  private isTokenExpiringSoon(): boolean {
    if (!this.tokenExpiresAt) {
      return false
    }
    return Date.now() >= this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
  }

  /**
   * Retry once on authentication errors
   */
  private async withTokenRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (err) {
      if (err instanceof AuthenticationError) {
        this.log.warn('Authentication failed, refreshing token and retrying...')
        await this.refreshToken()
        return operation()
      }
      throw err
    }
  }

  /**
   * Ensures a valid token is available
   */
  private async ensureValidToken(): Promise<string> {
    if (this.currentLoginResponse && !this.isTokenExpiringSoon()) {
      return this.currentLoginResponse.id
    }
    const loginResponse = await this.refreshToken()
    return loginResponse.id
  }

  /**
   * Refreshes the authentication token
   */
  private async refreshToken(): Promise<LoginResponse> {
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise
    }

    this.tokenRefreshPromise = (async () => {
      const loginResponse = await this.client.login(this.config.email, this.config.password)
      this.setLoginResponse(loginResponse)

      // Update token in all accessory contexts
      this.accessories.forEach(acc => {
        if (acc.context) {
          acc.context.token = loginResponse.id
        }
      })

      // Update WebSocket with new login response
      if (this.webSocket) {
        this.webSocket.updateLoginResponse(loginResponse)
        this.webSocket.connect()
      }

      this.log.info('Token refreshed successfully')
      return loginResponse
    })()

    try {
      return await this.tokenRefreshPromise
    } finally {
      this.tokenRefreshPromise = null
    }
  }

  /**
   * Starts polling for device updates
   */
  private startPolling(): void {
    const intervalSeconds = this.config.pollInterval ?? this.config.pollingInterval ?? 30
    const interval = Math.max(intervalSeconds * 1000, 10000)
    
    this.pollingInterval = setInterval(() => this.pollDevices(), interval)
  }

  /**
   * Polls all devices for updates
   */
  private async pollDevices(): Promise<void> {
    if (!this.residenceId) {
      return
    }

    try {
      const devices = await this.withTokenRetry(async () => {
        const token = await this.ensureValidToken()
        return this.client.getDevices(this.residenceId as string, token)
      })
      
      for (const device of devices) {
        if (device?.id) {
          this.handleWebSocketUpdate({
            id: device.id,
            power: (device as unknown as DeviceStatus).power,
            brightness: (device as unknown as DeviceStatus).brightness,
          })
        }
      }
    } catch (err) {
      this.log.debug(`Polling error: ${sanitizeError(err)}`)
    }
  }

  /**
   * Saves device states to persistence
   */
  private saveDeviceStates(): void {
    try {
      this.accessories.forEach(accessory => {
        const device = accessory.context?.device
        if (device) {
          const service = accessory.getService(hap.Service.Lightbulb) ||
                          accessory.getService(hap.Service.Fan) ||
                          accessory.getService(hap.Service.Switch) ||
                          accessory.getService(hap.Service.Outlet)
          
          if (service) {
            const isOn = service.getCharacteristic(hap.Characteristic.On).value as boolean
            this.devicePersistence.updateDevice(device.id, {
              id: device.id,
              name: device.name,
              model: device.model,
              power: isOn ? POWER_ON : POWER_OFF,
            })
          }
        }
      })
      
      this.devicePersistence.save()
    } catch (err) {
      this.log.error(`Failed to save device states: ${sanitizeError(err)}`)
    }
  }

  /**
   * Starts periodic cleanup
   */
  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.client.clearCache()
    }, 60000)
  }

  /**
   * Cleans up resources
   */
  private cleanup(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    
    if (this.webSocket) {
      this.webSocket.close()
      this.webSocket = null
    }
  }

  /**
   * Removes all accessories
   */
  removeAccessories(): void {
    this.log.info('Removing all accessories')
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories)
    this.accessories.length = 0
  }
}

/**
 * Homebridge plugin registration
 */
export function registerPlatform(homebridge: HomebridgeAPI): void {
  hap = homebridge.hap
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, LevitonDecoraSmartPlatform, true)
}

export default registerPlatform
