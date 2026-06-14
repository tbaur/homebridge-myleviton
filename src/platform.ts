/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge platform plugin for My Leviton Decora Smart devices
 */

import * as path from 'path'
import { LevitonApiClient } from './api/client'
import { LevitonWebSocket, createWebSocket } from './api/websocket'
import { DevicePersistence, getDevicePersistence } from './api/persistence'
import { DiagnosticsCollector } from './diagnostics/collector'
import type { DiagnosticsReaders, DeviceGauges } from './diagnostics/collector'
import { createStructuredLogger, StructuredLogger } from './utils/logger'
import { sanitizeError, sanitizeHapName, isValidHapName } from './utils/sanitizers'
import { validateConfig as validateConfigSchema } from './utils/validators'
import { AuthenticationError, ConfigurationError, ApiResponseError } from './errors'
import type {
  LevitonConfig,
  DeviceInfo,
  DeviceStatus,
  DeviceType,
  PowerState,
  WebSocketPayload,
  LoginResponse,
  DiagnosticsSnapshot,
} from './types'

/**
 * Resolve the installed plugin version for diagnostics lifecycle reporting.
 * Read lazily via require so it works from both dist/ and ts-jest without
 * pulling package.json outside the TypeScript rootDir.
 */
function getPluginVersion(): string {
  try {
     
    return (require('../package.json').version as string) || 'unknown'
  } catch {
    return 'unknown'
  }
}

// Plugin constants
const PLUGIN_NAME = 'homebridge-myleviton'
const PLATFORM_NAME = 'MyLevitonDecoraSmart'
const UUID_PREFIX = 'myleviton-'

// Power states
const POWER_ON: PowerState = 'ON'
const POWER_OFF: PowerState = 'OFF'

// Token refresh buffer (refresh a few minutes before expiry)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const TOKEN_REFRESH_FAILURE_COOLDOWN_MS = 10 * 1000
const POLL_DEVICE_CONCURRENCY = 4

// Self-healing startup: if initial device discovery fails (e.g. a transient
// Leviton/network outage at boot), retry with exponential backoff instead of
// leaving the plugin permanently dead until a manual Homebridge restart.
const INITIAL_INIT_RETRY_MS = 15 * 1000
const MAX_INIT_RETRY_MS = 5 * 60 * 1000

// Device model arrays for type checking
const DIMMER_MODELS = ['DWVAA', 'DW1KD', 'DW6HD', 'D26HD', 'D23LP', 'DW3HL', 'D2ELV', 'D2710', 'DN6HD']
const MOTION_DIMMER_MODELS = ['D2MSD']
const OUTLET_MODELS = ['DW15R', 'DW15A', 'DW15P', 'D215P', 'D215O']  // D215P is plug-in switch, D215O is outdoor plug-in switch
const SWITCH_MODELS = ['DW15S', 'D215S']
const CONTROLLER_MODELS = ['DW4BC']  // Button controllers - no state, skip
const FAN_MODELS = ['DW4SF', 'D24SF']  // Fan speed controllers

// Optional cloud-connectivity status sensor
const CONNECTIVITY_UUID_SEED = UUID_PREFIX + 'connectivity'
const DEFAULT_CONNECTIVITY_NAME = 'Leviton Cloud'

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
  private lastRefreshFailureAt: number | null = null
  
  // WebSocket connection
  private webSocket: LevitonWebSocket | null = null
  
  // Polling
  private pollingInterval: ReturnType<typeof setInterval> | null = null
  private isPolling = false
  private residenceId: string | null = null
  
  // Device persistence
  private devicePersistence: DevicePersistence
  
  // Startup retry
  private initRetryTimer: ReturnType<typeof setTimeout> | null = null
  private initAttempt = 0
  private isShuttingDown = false

  // Optional cloud-connectivity status sensor
  private connectivityService: Service | null = null
  private isCloudOnline = true

  // Track recent HomeKit commands to avoid logging them as "external"
  private recentHomeKitCommands: Map<string, number> = new Map()

  // Opt-in diagnostics subsystem (off unless diagnosticsInterval > 0)
  private readonly diagnostics: DiagnosticsCollector
  private diagnosticsTimer: ReturnType<typeof setInterval> | null = null
  private lastDiagnosticsHealth: 'healthy' | 'degraded' | null = null
  private lastBreakerState: string | null = null
  private lastTokenRefreshAt: number | null = null
  private lastExcludedCount = 0
  private wsHasDisconnected = false

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

    // Diagnostics collector is created before the client so the client's metrics
    // hook can feed it. Counters always accumulate (cheap, in-memory); reports
    // are only emitted when diagnosticsInterval > 0.
    this.diagnostics = new DiagnosticsCollector({
      pluginVersion: getPluginVersion(),
      config: config ?? ({} as LevitonConfig),
    })

    // Setup API client. Each platform instance owns its own client (and thus its
    // own circuit breaker, rate limiter, and cache) so multiple configured
    // accounts don't share resilience state and trip each other.
    this.client = new LevitonApiClient({
      timeout: config?.connectionTimeout || 10000,
      logger: {
        debug: (msg: string) => this.log.debug(msg),
        info: (msg: string) => this.log.info(msg),
        warn: (msg: string) => this.log.warn(msg),
      },
      metrics: sample => this.diagnostics.apiRequest(sample.durationMs, sample.ok),
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
      this.startDiagnostics()
    })
    
    // Cleanup on shutdown
    api.on('shutdown', () => {
      this.isShuttingDown = true
      this.saveDeviceStates()
      this.cleanup()
    })
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
   * Initializes the platform, retrying on transient failures so a temporary
   * outage at startup doesn't leave the plugin permanently inert.
   */
  private async initialize(): Promise<void> {
    try {
      await this.discoverAndSetup()
      this.initAttempt = 0
    } catch (error) {
      // Permanent misconfiguration (bad credentials, invalid config) won't fix
      // itself — don't hammer the API. Everything else is treated as transient.
      if (error instanceof AuthenticationError || error instanceof ConfigurationError) {
        this.log.error(`Initialization failed and will not be retried automatically: ${sanitizeError(error)}`)
        return
      }

      this.initAttempt++
      const delay = Math.min(
        INITIAL_INIT_RETRY_MS * Math.pow(2, this.initAttempt - 1),
        MAX_INIT_RETRY_MS,
      )
      this.log.warn(
        `Initialization failed (attempt ${this.initAttempt}), retrying in ${Math.round(delay / 1000)}s: ${sanitizeError(error)}`,
      )
      this.scheduleInitializeRetry(delay)
    }
  }

  /**
   * Schedules a delayed re-initialization attempt unless the platform is
   * shutting down. Only one retry is ever queued at a time.
   */
  private scheduleInitializeRetry(delayMs: number): void {
    if (this.isShuttingDown || this.initRetryTimer) {
      return
    }
    this.initRetryTimer = setTimeout(() => {
      this.initRetryTimer = null
      void this.initialize()
    }, delayMs)
  }

  /**
   * Performs device discovery and accessory setup. Throws on failure so the
   * caller can decide whether to retry.
   */
  private async discoverAndSetup(): Promise<void> {
    this.log.info('Starting My Leviton Decora Smart platform...')

    {
      // Clean up any duplicate cache entries before processing
      // This is defensive - duplicates can occur due to race conditions in older versions
      this.deduplicateAccessories()

      const { devices, loginResponse, residenceId } = await this.discoverDevices()
      
      this.setLoginResponse(loginResponse)
      this.residenceId = residenceId

      // Discovery succeeded — we just reached the cloud. Set up the optional
      // connectivity sensor and mark it online before processing devices.
      this.setupConnectivitySensor()
      this.updateConnectivity(true)

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
          const existingAccessory = this.findAccessoryByDevice(device)
          if (existingAccessory) {
            this.removeCachedAccessory(existingAccessory)
          }
          excludedCount++
          continue
        }

        // Check if we have a cached accessory for this device
        const existingAccessory = this.findAccessoryByDevice(device)
        
        if (existingAccessory) {
          // Update cached accessory with fresh device data
          existingAccessory.context.device = device
          // Scrub any auth token persisted by older versions. The token is never
          // read from context (requests use the in-memory login response), and
          // persisting it leaks a live credential into the on-disk accessory cache.
          delete existingAccessory.context.token
          this.syncAccessoryMetadata(existingAccessory, device)
          
          // Persist the updated context to cache file
          this.api.updatePlatformAccessories([existingAccessory])
          
          // Setup service handlers (deferred from configureAccessory)
          await this.setupService(existingAccessory)
          
          cachedCount++
        } else {
          // New device - create accessory
          await this.addAccessory(device)
          newDevices++
        }
      }

      this.lastExcludedCount = excludedCount

      this.log.info(`Found ${devices.length} devices (${cachedCount} cached, ${newDevices} new, ${excludedCount} excluded)`)
      
      // Start polling
      this.startPolling()
      
      this.log.info('Platform ready')
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

    // Setup WebSocket for real-time updates. Close any socket left over from a
    // previous (failed) initialization attempt before creating a new one.
    if (this.webSocket) {
      this.webSocket.close()
      this.webSocket = null
    }
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
        {
          ...(this.config.connectionTimeout ? { connectionTimeout: this.config.connectionTimeout } : {}),
          // Surface real-time push connectivity on the optional status sensor and
          // feed reconnect counts into diagnostics.
          onConnectionChange: (connected: boolean) => this.handleWsConnectionChange(connected),
        },
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
      let newBrightness: number | undefined
      
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
      }
      // No else — switches/outlets don't have brightness, just skip to power update
      
      // Log brightness change if different and not from recent HomeKit command
      if (newBrightness !== undefined && currentBrightness !== undefined && currentBrightness !== newBrightness) {
        const lastCommandTime = device?.id ? this.recentHomeKitCommands.get(device.id) : undefined
        const isRecentCommand = lastCommandTime && (Date.now() - lastCommandTime) < 5000 // 5 second window
        if (!isRecentCommand) {
          this.diagnostics.externalChange()
          this.log.info(`${accessory.displayName}: ${newBrightness}% (external)`, {
            deviceId: device?.id,
            operation: 'externalBrightnessUpdate',
            brightness: newBrightness,
          })
        }
      }
    }

    // Update power state
    if (power !== undefined) {
      const newPowerBool = power === POWER_ON
      primaryService.getCharacteristic(hap.Characteristic.On).updateValue(newPowerBool)
      
      // Log power change if different and not from recent HomeKit command
      if (currentPowerState !== power) {
        const lastCommandTime = device?.id ? this.recentHomeKitCommands.get(device.id) : undefined
        const isRecentCommand = lastCommandTime && (Date.now() - lastCommandTime) < 5000 // 5 second window
        if (!isRecentCommand) {
          this.diagnostics.externalChange()
          this.log.info(`${accessory.displayName}: ${power} (external)`, {
            deviceId: device?.id,
            operation: 'externalPowerUpdate',
            power,
          })
        }
      }
    }

    // Update motion sensor
    const motionService = accessory.getService(hap.Service.MotionSensor)
    if (motionService && (occupancy !== undefined || motion !== undefined)) {
      const motionDetected = occupancy === true || motion === true
      motionService.getCharacteristic(hap.Characteristic.MotionDetected).updateValue(motionDetected)
    }

    // Invalidate API cache for this device so next getStatus() fetches fresh data
    // This ensures cached API responses don't become stale after real-time updates
    this.client.invalidateDeviceCache(String(payload.id))
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
   * Adds a new accessory
   */
  async addAccessory(device: DeviceInfo): Promise<void> {
    if (!device?.serial || !device?.name) {
      this.log.error('Invalid device object provided to addAccessory')
      return
    }

    this.log.info(`Adding device: ${device.name} (${device.model})`)

    const uuid = hap.uuid.generate(UUID_PREFIX + device.serial)
    const accessory = new this.api.platformAccessory(this.getHapDeviceName(device), uuid)

    // Note: the auth token is intentionally NOT stored in context. It's never
    // read back (requests use the in-memory login response) and persisting it
    // would write a live credential to the on-disk accessory cache.
    accessory.context = { device }

    this.syncAccessoryMetadata(accessory, device)

    // Setup service
    await this.setupService(accessory)

    // Register with Homebridge
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
    this.accessories.push(accessory)
  }

  /**
   * Creates (or removes) the optional cloud-connectivity status sensor.
   *
   * Exposed as a HomeKit ContactSensor: "contact detected" means the plugin can
   * reach the Leviton cloud, "contact not detected" means it cannot — so users
   * can build automations or notifications on loss of connectivity. The state is
   * driven by the WebSocket connection callback and the polling heartbeat.
   */
  private setupConnectivitySensor(): void {
    const uuid = hap.uuid.generate(CONNECTIVITY_UUID_SEED)
    const existing = this.accessories.find(acc => acc.UUID === uuid)

    // Disabled: remove any previously-created sensor so toggling off takes effect.
    if (!this.config.connectivitySensor) {
      if (existing) {
        this.log.info('Removing connectivity sensor (disabled in config)')
        this.removeCachedAccessory(existing)
      }
      this.connectivityService = null
      return
    }

    const name = sanitizeHapName(
      this.config.connectivitySensorName || DEFAULT_CONNECTIVITY_NAME,
      DEFAULT_CONNECTIVITY_NAME,
    )

    let accessory = existing
    if (!accessory) {
      accessory = new this.api.platformAccessory(name, uuid)
      accessory.context = { connectivity: true }
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.accessories.push(accessory)
      this.log.info(`Added connectivity sensor: ${name}`)
    } else {
      accessory.context = { connectivity: true }
      this.updateAccessoryDisplayName(accessory, name)
    }

    const service = accessory.getService(hap.Service.ContactSensor) ||
      accessory.addService(hap.Service.ContactSensor, name)
    service.setCharacteristic(hap.Characteristic.Name, name)
    service.getCharacteristic(hap.Characteristic.StatusActive).updateValue(true)

    const infoService = accessory.getService(hap.Service.AccessoryInformation)
    if (infoService) {
      infoService
        .setCharacteristic(hap.Characteristic.Name, name)
        .setCharacteristic(hap.Characteristic.Manufacturer, 'homebridge-myleviton')
        .setCharacteristic(hap.Characteristic.Model, 'Cloud Connectivity')
        .setCharacteristic(hap.Characteristic.SerialNumber, CONNECTIVITY_UUID_SEED)
    }

    this.connectivityService = service
    this.api.updatePlatformAccessories([accessory])
  }

  /**
   * Reflects the latest cloud-connectivity state on the status sensor.
   * No-op when the sensor is disabled.
   */
  private updateConnectivity(online: boolean): void {
    if (!this.connectivityService) {
      return
    }

    const changed = online !== this.isCloudOnline
    this.isCloudOnline = online

    this.connectivityService
      .getCharacteristic(hap.Characteristic.ContactSensorState)
      .updateValue(
        online
          ? hap.Characteristic.ContactSensorState.CONTACT_DETECTED
          : hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      )
    this.connectivityService
      .getCharacteristic(hap.Characteristic.StatusFault)
      .updateValue(
        online
          ? hap.Characteristic.StatusFault.NO_FAULT
          : hap.Characteristic.StatusFault.GENERAL_FAULT,
      )

    if (changed) {
      if (online) {
        this.log.info('Leviton cloud connectivity restored')
      } else {
        this.log.warn('Leviton cloud connectivity lost')
      }
    }
  }

  /**
   * Gets a HAP-valid name while keeping the Leviton device name as the source.
   */
  private getHapDeviceName(device: DeviceInfo): string {
    return sanitizeHapName(device.name || 'Unknown Device', 'Unknown Device')
  }

  /**
   * Updates an accessory's display name on both the PlatformAccessory wrapper
   * and the underlying HAP Accessory. Homebridge serializes the wrapper field
   * but the HAP Accessory.displayName is what HAP-NodeJS validates at construction
   * during cache deserialization, so both must stay in sync.
   */
  private updateAccessoryDisplayName(accessory: PlatformAccessory, name: string): void {
    if (typeof accessory.updateDisplayName === 'function') {
      accessory.updateDisplayName(name)
      return
    }
    accessory.displayName = name
    if (accessory._associatedHAPAccessory) {
      accessory._associatedHAPAccessory.displayName = name
    }
  }

  /**
   * Sanitizes the `displayName` field on every service attached to an accessory.
   *
   * Why this matters: HAP-NodeJS's `Service.deserialize` reconstructs a service
   * with `new Constructor(json.displayName, json.subtype)`, and the `Service`
   * constructor calls `checkName(this.displayName, "Name", displayName)` whenever
   * the displayName is non-empty. That warning has the same format as the
   * `Accessory` constructor's warning, so cleaning only the accessory's
   * displayName is not sufficient — the cached `services[i].displayName` field
   * must also be sanitized so the next deserialize cycle is silent.
   */
  private normalizeServiceDisplayNames(accessory: PlatformAccessory): boolean {
    const services = accessory.services as Service[] | undefined
    if (!Array.isArray(services) || services.length === 0) {
      return false
    }

    let mutated = false
    const accessoryFallback =
      (typeof accessory.displayName === 'string' && accessory.displayName) ||
      'Leviton Device'

    for (const service of services) {
      const original = typeof service?.displayName === 'string' ? service.displayName : ''
      if (!original || isValidHapName(original)) {
        continue
      }

      const sanitized = sanitizeHapName(original, accessoryFallback)
      if (sanitized === original) {
        continue
      }

      service.displayName = sanitized
      mutated = true

      if (typeof service.testCharacteristic === 'function' &&
          service.testCharacteristic(hap.Characteristic.Name)) {
        try {
          service.setCharacteristic(hap.Characteristic.Name, sanitized)
        } catch {
          // Some services reject Name updates (e.g. read-only on certain HAP versions);
          // mutating displayName above is what actually affects the cache file.
        }
      }
    }

    return mutated
  }

  /**
   * Keeps cached Homebridge metadata aligned with the latest Leviton device record.
   * Also normalizes every service's `displayName` field, since that value is what
   * HAP-NodeJS validates during cache deserialization on subsequent restarts.
   */
  private syncAccessoryMetadata(accessory: PlatformAccessory, device: DeviceInfo): void {
    const deviceName = this.getHapDeviceName(device)
    this.updateAccessoryDisplayName(accessory, deviceName)

    const infoService = accessory.getService(hap.Service.AccessoryInformation)
    if (infoService) {
      infoService
        .setCharacteristic(hap.Characteristic.Name, deviceName)
        .setCharacteristic(hap.Characteristic.SerialNumber, device.serial || 'Unknown')
        .setCharacteristic(hap.Characteristic.Manufacturer, device.manufacturer || 'Leviton')
        .setCharacteristic(hap.Characteristic.Model, device.model || 'Unknown')
        .setCharacteristic(hap.Characteristic.FirmwareRevision, device.version || 'Unknown')
    }

    this.syncExistingServiceNames(accessory, device)
    this.normalizeServiceDisplayNames(accessory)
  }

  /**
   * Configures a cached accessory.
   *
   * IMPORTANT: This must be synchronous. Homebridge calls this for each cached
   * accessory and does NOT await the result. If this were async with awaits,
   * the accessories array would be incomplete when didFinishLaunching fires,
   * causing race conditions where devices are incorrectly added as "new".
   *
   * Service setup is deferred to initialize() after deduplication.
   *
   * Cache name normalization: the HAP-NodeJS warning about invalid 'Name'
   * characteristics is emitted by the Accessory constructor at cache deserialize
   * time (see HAP-NodeJS Accessory.ts checkName() call in the constructor),
   * which runs *before* this hook. We can't suppress the very first warning, but
   * by sanitizing every cached field that feeds the next deserialize cycle and
   * persisting the cache via api.updatePlatformAccessories() synchronously here,
   * subsequent restarts will see clean names and emit no warning.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.normalizeCachedAccessoryNames(accessory)
    this.log.debug(`Configuring cached accessory: ${accessory.displayName}`)
    this.accessories.push(accessory)
  }

  /**
   * Sanitizes every name surface on a cached accessory and persists the cache
   * file synchronously so the next restart loads HAP-valid values.
   *
   * Three independent fields can carry stale invalid characters into a fresh
   * deserialize cycle and trigger HAP-NodeJS warnings:
   *   1. `accessory.displayName` (Accessory constructor checkName)
   *   2. `service.displayName` for each service (Service constructor checkName)
   *   3. `context.device.name` (read by initialize() on subsequent runs)
   * All three must be normalized before flushing.
   */
  private normalizeCachedAccessoryNames(accessory: PlatformAccessory): void {
    const cachedDevice = accessory.context?.device as DeviceInfo | undefined
    const sourceName =
      (typeof accessory.displayName === 'string' && accessory.displayName) ||
      cachedDevice?.name ||
      ''

    if (!sourceName) {
      return
    }

    const sanitizedName = sanitizeHapName(sourceName, 'Leviton Device')
    const accessoryNeedsRewrite = !cachedDevice
      ? accessory.displayName !== sanitizedName
      : (
          cachedDevice.name !== sanitizedName ||
          accessory.displayName !== sanitizedName
        )

    // Detect service rewrites BEFORE syncAccessoryMetadata, since that path also
    // normalizes services (idempotently) and would mask the bool we need to
    // decide whether the on-disk cache requires a flush.
    const servicesMutated = this.normalizeServiceDisplayNames(accessory)

    if (cachedDevice) {
      cachedDevice.name = sanitizedName
      this.syncAccessoryMetadata(accessory, cachedDevice)
    } else {
      this.updateAccessoryDisplayName(accessory, sanitizedName)
      const infoService = accessory.getService(hap.Service.AccessoryInformation)
      if (infoService) {
        infoService.setCharacteristic(hap.Characteristic.Name, sanitizedName)
      }
    }

    if (!accessoryNeedsRewrite && !servicesMutated) {
      return
    }

    try {
      this.api.updatePlatformAccessories([accessory])
    } catch (err) {
      this.log.warn(`Failed to persist sanitized cache for ${sanitizedName}: ${sanitizeError(err)}`)
    }
  }

  /**
   * Removes duplicate cache entries (same UUID appearing multiple times)
   * 
   * This is a defensive cleanup that runs on every startup. Duplicates can occur
   * due to race conditions in older versions or cache file corruption. Since
   * duplicates share the same UUID, HomeKit only sees one accessory - removing
   * the extra cache entries has no user-visible effect.
   * 
   * @returns Number of duplicate entries removed
   */
  private deduplicateAccessories(): number {
    const seen = new Set<string>()
    const duplicates: PlatformAccessory[] = []
    const unique: PlatformAccessory[] = []

    for (const accessory of this.accessories) {
      // Skip accessories without a valid UUID (shouldn't happen, but defensive)
      if (!accessory.UUID) {
        this.log.warn(`Skipping accessory without UUID: ${accessory.displayName}`)
        continue
      }

      if (seen.has(accessory.UUID)) {
        duplicates.push(accessory)
        this.log.debug(`Duplicate cache entry: "${accessory.displayName}" (UUID: ${accessory.UUID})`)
      } else {
        seen.add(accessory.UUID)
        unique.push(accessory)
      }
    }

    if (duplicates.length > 0) {
      // Unregister duplicates from Homebridge (removes from cache file)
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, duplicates)
      
      // Update our array to only contain unique accessories
      this.accessories.length = 0
      this.accessories.push(...unique)
      
      this.log.info(`Removed ${duplicates.length} duplicate cache entries (${unique.length} unique accessories)`)
    }

    return duplicates.length
  }

  /**
   * Finds a cached accessory matching the given device by serial number
   * Uses case-insensitive comparison for robustness
   */
  private findAccessoryByDevice(device: DeviceInfo): PlatformAccessory | undefined {
    const deviceSerial = String(device.serial || '').trim().toUpperCase()
    if (!deviceSerial) {
      return undefined
    }
    
    return this.accessories.find(acc => {
      const cachedSerial = String(acc.context?.device?.serial || '').trim().toUpperCase()
      return cachedSerial === deviceSerial
    })
  }

  /**
   * Removes an accessory from Homebridge cache and local tracking
   */
  private removeCachedAccessory(accessory: PlatformAccessory): void {
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
    const index = this.accessories.indexOf(accessory)
    if (index !== -1) {
      this.accessories.splice(index, 1)
    }
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
  private async getStatus(device: DeviceInfo, fallbackStatus?: DeviceStatus): Promise<DeviceStatus> {
    try {
      const status = await this.withTokenRetry(async () => {
        const token = await this.ensureValidToken()
        return this.client.getDeviceStatus(device.id, token)
      })
      this.devicePersistence.updateFromStatus(device.id, status)
      return status
    } catch (err) {
      this.log.error(`Failed to get status for ${device.name}: ${sanitizeError(err)}`)
      if (fallbackStatus) {
        return fallbackStatus
      }
      const cachedStatus = this.devicePersistence.getCachedStatus(device.id)
      if (cachedStatus) {
        return {
          minLevel: 1,
          maxLevel: 100,
          ...cachedStatus,
        }
      }
      return { power: POWER_OFF, brightness: 0, minLevel: 1, maxLevel: 100 }
    }
  }

  /**
   * Captures the current HomeKit state before reconfiguring a cached accessory.
   */
  private getCurrentServiceStatus(service: Service, levelCharacteristic?: unknown): DeviceStatus | undefined {
    const onValue = service.getCharacteristic(hap.Characteristic.On).value
    if (typeof onValue !== 'boolean') {
      return undefined
    }

    const status: DeviceStatus = {
      power: onValue ? POWER_ON : POWER_OFF,
      minLevel: 1,
      maxLevel: 100,
    }

    if (levelCharacteristic) {
      const levelValue = service.getCharacteristic(levelCharacteristic).value
      if (typeof levelValue === 'number' && Number.isFinite(levelValue)) {
        status.brightness = levelValue
      }
    }

    return status
  }

  /**
   * Sets up a lightbulb service
   * @returns The device status used for initialization (allows callers to reuse it)
   */
  private async setupLightbulbService(accessory: PlatformAccessory, device: DeviceInfo): Promise<DeviceStatus> {
    const serviceName = this.getHapDeviceName(device)
    const existingService = this.getServiceByNameOrType(accessory, hap.Service.Lightbulb, serviceName)
    const fallbackStatus = existingService
      ? this.getCurrentServiceStatus(existingService, hap.Characteristic.Brightness)
      : undefined
    const status = await this.getStatus(device, fallbackStatus)
    const service = existingService || accessory.addService(hap.Service.Lightbulb, serviceName)
    this.syncServiceName(service, serviceName)

    // Calculate valid brightness range
    const minBrightness = status.minLevel || 1
    const maxBrightness = status.maxLevel || 100
    // Ensure brightness is within valid range (0 is invalid for HomeKit Brightness which has minValue=1)
    const rawBrightness = typeof status.brightness === 'number' ? status.brightness : 0
    const safeBrightness = rawBrightness < minBrightness ? minBrightness : rawBrightness

    // Setup On characteristic
    // No 'get' handler — Homebridge returns the cached value set by updateValue(),
    // which is kept current by WebSocket push updates and polling fallback.
    const onChar = service.getCharacteristic(hap.Characteristic.On)
    onChar.removeAllListeners('get')
    onChar.removeAllListeners('set')
    onChar.on('set', this.createPowerSetter(device))
    onChar.updateValue(status.power === POWER_ON)

    // Setup Brightness characteristic
    // Use getCharacteristic which always returns a valid Characteristic object
    // No 'get' handler — value kept current by WebSocket + polling via updateValue()
    const brightnessChar = service.getCharacteristic(hap.Characteristic.Brightness)
    // For cached accessories, update value to safe minimum BEFORE setting restrictive props
    // This prevents HAP validation error when cached value (e.g., 0) violates new minValue
    brightnessChar.updateValue(safeBrightness)
    brightnessChar.setProps({ minValue: minBrightness, maxValue: maxBrightness, minStep: 1 })
    brightnessChar.removeAllListeners('get')
    brightnessChar.removeAllListeners('set')
    brightnessChar.on('set', this.createBrightnessSetter(device))

    return status
  }

  /**
   * Sets up a motion dimmer service
   */
  private async setupMotionDimmerService(accessory: PlatformAccessory, device: DeviceInfo): Promise<void> {
    // Reuse the status returned by setupLightbulbService to avoid a second API call
    const status = await this.setupLightbulbService(accessory, device)
    const motionName = sanitizeHapName(`${device.name} Motion`, 'Motion Sensor')
    const motionService = accessory.getService(hap.Service.MotionSensor) ||
                          accessory.addService(hap.Service.MotionSensor, motionName)
    this.syncServiceName(motionService, motionName)
    
    motionService
      .getCharacteristic(hap.Characteristic.MotionDetected)
      .updateValue(status.occupancy === true || status.motion === true)
  }

  /**
   * Sets up a fan service
   */
  private async setupFanService(accessory: PlatformAccessory, device: DeviceInfo): Promise<void> {
    const serviceName = this.getHapDeviceName(device)
    const existingService = this.getServiceByNameOrType(accessory, hap.Service.Fan, serviceName)
    const fallbackStatus = existingService
      ? this.getCurrentServiceStatus(existingService, hap.Characteristic.RotationSpeed)
      : undefined
    const status = await this.getStatus(device, fallbackStatus)
    const service = existingService || accessory.addService(hap.Service.Fan, serviceName)
    this.syncServiceName(service, serviceName)

    // Setup On characteristic — no 'get' handler, value kept current by WebSocket + polling
    const onChar = service.getCharacteristic(hap.Characteristic.On)
    onChar.removeAllListeners('get')
    onChar.removeAllListeners('set')
    onChar.on('set', this.createPowerSetter(device))
    onChar.updateValue(status.power === POWER_ON)

    // Setup RotationSpeed characteristic - set props before value
    // No 'get' handler — value kept current by WebSocket + polling via updateValue()
    const speedChar = service.getCharacteristic(hap.Characteristic.RotationSpeed)
    speedChar.setProps({ minValue: 0, maxValue: status.maxLevel || 100, minStep: status.minLevel || 1 })
    speedChar.removeAllListeners('get')
    speedChar.removeAllListeners('set')
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
    const serviceName = this.getHapDeviceName(device)
    const existingService = this.getServiceByNameOrType(accessory, ServiceType, serviceName)
    const fallbackStatus = existingService
      ? this.getCurrentServiceStatus(existingService)
      : undefined
    const status = await this.getStatus(device, fallbackStatus)
    const service = existingService || accessory.addService(ServiceType, serviceName)
    this.syncServiceName(service, serviceName)

    // Remove existing listeners to prevent stacking on cached accessories
    // No 'get' handler — value kept current by WebSocket + polling via updateValue()
    const onChar = service.getCharacteristic(hap.Characteristic.On)
    onChar.removeAllListeners('get')
    onChar.removeAllListeners('set')
    onChar.on('set', this.createPowerSetter(device))
    onChar.updateValue(status.power === POWER_ON)
  }

  private getServiceByNameOrType(accessory: PlatformAccessory, ServiceType: Service, serviceName: string): Service | undefined {
    return accessory.getService(ServiceType, serviceName) || accessory.getService(ServiceType)
  }

  private syncServiceName(service: Service, serviceName: string): void {
    service.setCharacteristic(hap.Characteristic.Name, serviceName)
  }

  private syncExistingServiceNames(accessory: PlatformAccessory, device: DeviceInfo): void {
    const serviceName = this.getHapDeviceName(device)
    const serviceTypes = [
      hap.Service.Lightbulb,
      hap.Service.Fan,
      hap.Service.Switch,
      hap.Service.Outlet,
    ]

    for (const serviceType of serviceTypes) {
      const service = accessory.getService(serviceType)
      if (service) {
        this.syncServiceName(service, serviceName)
      }
    }

    const motionService = accessory.getService(hap.Service.MotionSensor)
    if (motionService) {
      this.syncServiceName(motionService, sanitizeHapName(`${device.name} Motion`, 'Motion Sensor'))
    }
  }

  /**
   * Creates a power setter handler
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createPowerSetter(device: DeviceInfo): any {
    return async (value: boolean, callback: (err?: Error) => void) => {
      const startTime = Date.now()
      // Track this HomeKit command to avoid logging it as "external" later
      this.recentHomeKitCommands.set(device.id, Date.now())
      this.diagnostics.command()
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
        this.recordThrottleIfRateLimited(err)
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
      // Track this HomeKit command to avoid logging it as "external" later
      this.recentHomeKitCommands.set(device.id, Date.now())
      this.diagnostics.command()
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
        this.recordThrottleIfRateLimited(err)
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
        this.diagnostics.retry()
        return await operation()
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

    if (
      this.lastRefreshFailureAt !== null &&
      Date.now() - this.lastRefreshFailureAt < TOKEN_REFRESH_FAILURE_COOLDOWN_MS
    ) {
      const remainingMs = TOKEN_REFRESH_FAILURE_COOLDOWN_MS - (Date.now() - this.lastRefreshFailureAt)
      this.log.debug(`Token refresh throttled after recent failure (${Math.ceil(remainingMs / 1000)}s remaining)`)
      throw new AuthenticationError('Token refresh temporarily throttled after recent failure')
    }

    this.tokenRefreshPromise = (async () => {
      const loginResponse = await this.client.login(this.config.email, this.config.password)
      this.setLoginResponse(loginResponse)

      // Update WebSocket with new login response
      if (this.webSocket) {
        this.webSocket.updateLoginResponse(loginResponse)
        this.webSocket.connect()
      }

      this.lastRefreshFailureAt = null
      this.lastTokenRefreshAt = Date.now()
      this.diagnostics.tokenRefresh()
      this.log.info('Token refreshed successfully')
      return loginResponse
    })()

    try {
      return await this.tokenRefreshPromise
    } catch (err) {
      this.lastRefreshFailureAt = Date.now()
      throw err
    } finally {
      this.tokenRefreshPromise = null
    }
  }

  /**
   * Starts polling for device updates
   */
  private startPolling(): void {
    if (this.config.pollInterval === undefined && this.config.pollingInterval !== undefined) {
      this.log.warn("Config option 'pollingInterval' is deprecated; use 'pollInterval' instead.")
    }
    const intervalSeconds = this.config.pollInterval ?? this.config.pollingInterval ?? 30
    const interval = Math.max(intervalSeconds * 1000, 10000)
    
    this.pollingInterval = setInterval(async () => {
      if (this.isPolling) {
        this.log.debug('Skipping poll tick because previous poll cycle is still running')
        return
      }

      this.isPolling = true
      try {
        await this.pollDevices()
      } catch (err) {
        this.log.debug(`Polling cycle failed: ${sanitizeError(err)}`)
      } finally {
        this.isPolling = false
      }
    }, interval)
  }

  /**
   * Polls all devices for updates
   * 
   * This is a fallback mechanism when WebSocket updates are unavailable.
   * Fetches actual device status from the API for each accessory.
   * 
   * IMPORTANT: On API failure, we preserve current HomeKit state rather than
   * updating with fallback values. This prevents incorrect state during outages.
   */
  private async pollDevices(): Promise<void> {
    if (!this.residenceId) {
      return
    }

    const pollTargets = this.accessories
      .map(accessory => accessory.context?.device)
      .filter((device): device is DeviceInfo => Boolean(device?.id))

    // Track whether any device fetch succeeded this cycle so the polling loop
    // can double as a cloud-reachability heartbeat for the connectivity sensor.
    let anyPollSucceeded = false
    let pollOk = 0
    let pollFailed = 0
    const cycleStart = Date.now()

    const pollSingleDevice = async (device: DeviceInfo): Promise<void> => {
      try {
        // Fetch actual device status from API (bypass getStatus to avoid fallback values)
        const status = await this.withTokenRetry(async () => {
          const token = await this.ensureValidToken()
          return this.client.getDeviceStatus(device.id, token)
        })

        anyPollSucceeded = true
        pollOk++

        // Only update HomeKit if we got real data from API. Include motion/
        // occupancy so motion sensors stay current via polling when the
        // WebSocket push channel is unavailable.
        this.handleWebSocketUpdate({
          id: device.id,
          power: status.power,
          brightness: status.brightness,
          occupancy: status.occupancy,
          motion: status.motion,
        })
      } catch (err) {
        // On API failure, preserve current HomeKit state - don't update with fallback values
        pollFailed++
        this.log.debug(`Polling skipped for ${device.name}: ${sanitizeError(err)}`)
      }
    }

    if (pollTargets.length === 0) {
      return
    }

    const workerCount = Math.min(POLL_DEVICE_CONCURRENCY, pollTargets.length)
    let nextIndex = 0

    const workers = Array.from({ length: workerCount }, async () => {
      // Shared index keeps worker fan-out bounded while still parallelizing requests.
      while (nextIndex < pollTargets.length) {
        const currentIndex = nextIndex++
        await pollSingleDevice(pollTargets[currentIndex])
      }
    })

    await Promise.all(workers)

    this.diagnostics.pollCycle(pollOk, pollFailed, Date.now() - cycleStart)

    // The poll cycle reached (or failed to reach) the cloud — use that as a
    // heartbeat for the connectivity sensor, covering the case where the
    // WebSocket is down but REST still works (or vice versa).
    this.updateConnectivity(anyPollSucceeded)
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
   * Cleans up resources
   */
  private cleanup(): void {
    // Emit the cumulative stop snapshot before tearing down the heartbeat timer.
    if (this.diagnosticsTimer) {
      try {
        this.emitDiagnostic('info', this.diagnostics.snapshot('diagnostics.stop', this.buildDiagnosticsReaders()))
      } catch (err) {
        this.log.debug(`Failed to emit diagnostics stop snapshot: ${sanitizeError(err)}`)
      }
      clearInterval(this.diagnosticsTimer)
      this.diagnosticsTimer = null
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }

    if (this.initRetryTimer) {
      clearTimeout(this.initRetryTimer)
      this.initRetryTimer = null
    }

    if (this.webSocket) {
      this.webSocket.close()
      this.webSocket = null
    }
  }

  /**
   * Records a rate-limit rejection on the diagnostics collector when a write
   * was throttled client-side (HTTP 429 from the rate limiter).
   */
  private recordThrottleIfRateLimited(err: unknown): void {
    if (err instanceof ApiResponseError && err.httpStatus === 429) {
      this.diagnostics.throttle()
    }
  }

  /**
   * Handles WebSocket connection-state changes: drives the connectivity sensor
   * and counts reconnections (a recovery after a prior disconnect) for diagnostics.
   */
  private handleWsConnectionChange(connected: boolean): void {
    if (connected && this.wsHasDisconnected) {
      this.diagnostics.wsReconnect()
      this.wsHasDisconnected = false
    } else if (!connected) {
      this.wsHasDisconnected = true
    }
    this.updateConnectivity(connected)
  }

  /**
   * Diagnostics heartbeat interval in milliseconds (0 when disabled).
   */
  private diagnosticsIntervalMs(): number {
    const seconds = this.config?.diagnosticsInterval
    if (typeof seconds !== 'number' || seconds <= 0) {
      return 0
    }
    return seconds * 1000
  }

  /**
   * Effective polling cadence in seconds (mirrors startPolling's clamping).
   */
  private pollingCadenceSeconds(): number {
    const intervalSeconds = this.config.pollInterval ?? this.config.pollingInterval ?? 30
    return Math.max(intervalSeconds, 10)
  }

  /**
   * Starts the diagnostics subsystem: emits the boot snapshot and schedules the
   * heartbeat. No-op unless diagnosticsInterval > 0.
   */
  private startDiagnostics(): void {
    const interval = this.diagnosticsIntervalMs()
    if (interval <= 0 || this.isShuttingDown) {
      return
    }

    const readers = this.buildDiagnosticsReaders()
    this.lastBreakerState = readers.clientStatus().circuitBreaker.state
    const startReport = this.diagnostics.snapshot('diagnostics.start', readers)
    this.lastDiagnosticsHealth = startReport.lifecycle.health
    this.emitDiagnostic('info', startReport)

    this.diagnosticsTimer = setInterval(() => this.diagnosticsHeartbeat(), interval)
  }

  /**
   * Emits a single heartbeat (per-interval deltas) and logs health transitions.
   */
  private diagnosticsHeartbeat(): void {
    // Detect circuit-breaker trips at heartbeat granularity (edge into OPEN).
    const breakerState = this.client.getStatus().circuitBreaker.state
    if (breakerState === 'OPEN' && this.lastBreakerState !== 'OPEN') {
      this.diagnostics.breakerTrip()
    }
    this.lastBreakerState = breakerState

    const report = this.diagnostics.buildHeartbeat(this.buildDiagnosticsReaders())
    this.emitDiagnostic('info', report)

    const health = report.lifecycle.health
    if (this.lastDiagnosticsHealth !== null && health !== this.lastDiagnosticsHealth) {
      const isDegraded = health === 'degraded'
      const transition: DiagnosticsSnapshot = {
        ...report,
        msg: isDegraded ? 'health.degraded' : 'health.recovered',
      }
      this.emitDiagnostic(isDegraded ? 'warn' : 'info', transition)
    }
    this.lastDiagnosticsHealth = health
  }

  /**
   * Builds the synchronous, in-memory readers the collector uses. Never performs
   * network I/O.
   */
  private buildDiagnosticsReaders(): DiagnosticsReaders {
    return {
      clientStatus: () => this.client.getStatus(),
      wsStatus: () => (this.webSocket ? this.webSocket.getStatus() : null),
      devices: () => this.collectDeviceGauges(),
      tokenExpiresInSec: () =>
        this.tokenExpiresAt === null
          ? null
          : Math.round((this.tokenExpiresAt - Date.now()) / 1000),
      tokenLastRefreshAt: () => this.lastTokenRefreshAt,
      tokenRefreshFailureActive: () =>
        this.lastRefreshFailureAt !== null &&
        Date.now() - this.lastRefreshFailureAt < TOKEN_REFRESH_FAILURE_COOLDOWN_MS,
      pollingCadenceSec: () => this.pollingCadenceSeconds(),
    }
  }

  /**
   * Computes absolute device gauges from the current accessories (the optional
   * connectivity sensor and stateless controllers are excluded).
   */
  private collectDeviceGauges(): DeviceGauges {
    const byType: Record<string, number> = {}
    let total = 0
    let on = 0

    for (const accessory of this.accessories) {
      if (accessory.context?.connectivity) {
        continue
      }
      const device = accessory.context?.device as DeviceInfo | undefined
      if (!device?.model) {
        continue
      }
      const type = deviceTypeForModel(device.model)
      if (type === null) {
        continue
      }

      total++
      byType[type] = (byType[type] || 0) + 1

      const service = this.getPrimaryService(accessory)
      if (service && service.getCharacteristic(hap.Characteristic.On).value === true) {
        on++
      }
    }

    return { total, on, byType, excluded: this.lastExcludedCount }
  }

  /**
   * Returns the primary controllable service for an accessory, if any.
   */
  private getPrimaryService(accessory: PlatformAccessory): Service | undefined {
    return (
      accessory.getService(hap.Service.Fan) ||
      accessory.getService(hap.Service.Lightbulb) ||
      accessory.getService(hap.Service.Switch) ||
      accessory.getService(hap.Service.Outlet) ||
      undefined
    )
  }

  /**
   * Emits a diagnostics report as a human-readable line plus structured JSON
   * fields (when structuredLogs is enabled). The report is already redacted.
   */
  private emitDiagnostic(level: 'info' | 'warn', report: DiagnosticsSnapshot): void {
    const context: Record<string, unknown> = {
      msg: report.msg,
      health: report.lifecycle.health,
      reasons: report.lifecycle.reasons.join(', '),
      uptimeSec: report.lifecycle.uptimeSec,
      pluginVersion: report.lifecycle.pluginVersion,
      devices: report.devices,
      websocket: report.websocket,
      circuitBreaker: report.circuitBreaker,
      rateLimiter: report.rateLimiter,
      cache: report.cache,
      polling: report.polling,
      token: report.token,
      api: report.api,
      activity: report.activity,
    }
    if (report.config) {
      context.config = report.config
    }
    this.log[level](formatDiagnosticLine(report), context)
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
 * Maps a device model to its HomeKit-facing type for diagnostics gauges.
 * Returns null for stateless controllers (which are not exposed). Unknown
 * models default to `switch`, mirroring setupService's fallback.
 */
function deviceTypeForModel(model: string): DeviceType | null {
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

/**
 * Builds the concise human-readable summary line for a diagnostics report.
 */
function formatDiagnosticLine(report: DiagnosticsSnapshot): string {
  const { lifecycle, devices, websocket, api } = report
  const reasonText = lifecycle.reasons.length > 0 ? ` [${lifecycle.reasons.join(', ')}]` : ''
  return (
    `${report.msg}: ${lifecycle.health}${reasonText} | ` +
    `devices ${devices.on}/${devices.total} on | ` +
    `ws ${websocket.state} | ` +
    `api p50 ${api.p50Ms}ms p95 ${api.p95Ms}ms (req ${api.requests}, err ${api.errors})`
  )
}

/**
 * Homebridge plugin registration
 */
export function registerPlatform(homebridge: HomebridgeAPI): void {
  hap = homebridge.hap
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, LevitonDecoraSmartPlatform, true)
}

export default registerPlatform
