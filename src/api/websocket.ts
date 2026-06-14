/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview WebSocket client for real-time device updates
 * 
 * Key implementation details:
 * 1. Use native WebSocket at wss://my.leviton.com/socket/websocket (NOT SockJS)
 * 2. Send the ENTIRE login response as token, not just the id
 * 3. Include Origin header for authentication
 */

import WebSocket from 'ws'
import { maskToken } from '../utils/sanitizers'
import type { WebSocketPayload, DeviceInfo, Logger, LoginResponse } from '../types'

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  /** Socket URL - must be native WebSocket endpoint */
  socketUrl: string
  /** Connection timeout in ms */
  connectionTimeout: number
  /** Maximum reconnection attempts */
  maxReconnectAttempts: number
  /** Initial reconnection delay in ms */
  initialReconnectDelay: number
  /** Maximum reconnection delay in ms */
  maxReconnectDelay: number
  /** Ping interval in ms to keep connection alive */
  pingInterval: number
  /**
   * Optional callback invoked when the live connection state changes:
   * `true` once authenticated and ready, `false` on a non-user close.
   * Used to surface real-time connectivity (e.g. a HomeKit status sensor).
   */
  onConnectionChange?: (connected: boolean) => void
}

/**
 * Default WebSocket configuration
 * Note: Uses native WebSocket endpoint, NOT SockJS
 */
export const DEFAULT_WEBSOCKET_CONFIG: WebSocketConfig = {
  socketUrl: 'wss://my.leviton.com/socket/websocket',
  connectionTimeout: 10000,
  maxReconnectAttempts: 10,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 60000,
  pingInterval: 30000, // Send ping every 30 seconds
}

/**
 * WebSocket message types
 */
enum MessageType {
  CHALLENGE = 'challenge',
  STATUS = 'status',
  NOTIFICATION = 'notification',
}

/**
 * WebSocket status values
 */
const STATUS_READY = 'ready'

/**
 * WebSocket close code descriptions
 */
const CLOSE_CODES: Record<number, string> = {
  1000: 'normal closure',
  1001: 'server going away',
  1002: 'protocol error',
  1003: 'unsupported data',
  1006: 'connection dropped',
  1007: 'invalid data',
  1008: 'policy violation',
  1009: 'message too big',
  1010: 'extension required',
  1011: 'server error',
  1012: 'service restart',
  1013: 'try again later',
  1014: 'bad gateway',
}

/**
 * Logger interface for WebSocket
 */
interface WebSocketLogger {
  debug: (message: string) => void
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

/**
 * WebSocket connection for real-time updates
 * 
 * Uses native WebSocket (not SockJS) and sends full login response for auth.
 */
export class LevitonWebSocket {
  private readonly config: WebSocketConfig
  private readonly logger: WebSocketLogger

  private ws: WebSocket | null = null
  private loginResponse: LoginResponse
  private devices: DeviceInfo[]
  private callback: (payload: WebSocketPayload) => void

  private reconnectAttempt = 0
  // Timestamp of the most recent inbound frame (any message or pong). Used as a
  // liveness signal for diagnostics; null until the first frame arrives.
  private lastInboundAt: number | null = null
  private timers: ReturnType<typeof setTimeout>[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private isConnecting = false
  private isClosed = false

  /**
   * Create a new WebSocket connection
   * 
   * @param loginResponse - The FULL login response from the API (not just the token id!)
   * @param devices - Array of devices to subscribe to
   * @param callback - Callback for device updates
   * @param logger - Logger instance
   * @param config - Optional configuration overrides
   */
  constructor(
    loginResponse: LoginResponse,
    devices: DeviceInfo[],
    callback: (payload: WebSocketPayload) => void,
    logger: WebSocketLogger | Logger,
    config: Partial<WebSocketConfig> = {},
  ) {
    // Filter out undefined values to avoid overwriting defaults
    const filteredConfig = Object.fromEntries(
      Object.entries(config).filter(([, v]) => v !== undefined),
    ) as Partial<WebSocketConfig>
    this.config = { ...DEFAULT_WEBSOCKET_CONFIG, ...filteredConfig }
    this.logger = this.normalizeLogger(logger)
    this.loginResponse = loginResponse
    this.devices = devices
    this.callback = callback
  }

  /**
   * Normalize logger to standard interface
   */
  private normalizeLogger(logger: WebSocketLogger | Logger): WebSocketLogger {
    if ('debug' in logger && 'info' in logger && 'warn' in logger && 'error' in logger) {
      return logger as WebSocketLogger
    }
    // Wrap basic logger. Use explicit presence checks rather than
    // `baseLogger.x?.(msg) ?? console.x(msg)`: a successful logging call returns
    // undefined, which would make the `??` fallback fire too and log twice.
    const baseLogger = logger as Logger
    return {
      debug: (msg: string) => { baseLogger.info ? baseLogger.info(`[debug] ${msg}`) : console.log(msg) },
      info: (msg: string) => { baseLogger.info ? baseLogger.info(msg) : console.log(msg) },
      warn: (msg: string) => { baseLogger.warn ? baseLogger.warn(msg) : console.warn(msg) },
      error: (msg: string) => { baseLogger.error ? baseLogger.error(msg) : console.error(msg) },
    }
  }

  /**
   * Update login response (after token refresh)
   * 
   * @param loginResponse - The new full login response
   */
  updateLoginResponse(loginResponse: LoginResponse): void {
    this.loginResponse = loginResponse
  }

  /**
   * Legacy method for compatibility - prefer updateLoginResponse
   * @deprecated Use updateLoginResponse instead
   */
  updateToken(token: string): void {
    // For backward compatibility, update just the id
    // But ideally callers should use updateLoginResponse with full object
    this.loginResponse = { ...this.loginResponse, id: token }
  }

  /**
   * Connect to WebSocket
   */
  connect(): void {
    if (this.isConnecting || this.isClosed || this.isConnected) {
      return
    }

    this.isConnecting = true
    this.logger.debug(`Connecting to WebSocket: ${this.config.socketUrl}`)

    try {
      // Native WebSocket with required headers
      this.ws = new WebSocket(this.config.socketUrl, {
        headers: {
          'Origin': 'https://my.leviton.com',
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
        },
      })

      this.setupEventHandlers()
    } catch (error) {
      this.isConnecting = false
      this.logger.error(`Failed to create WebSocket: ${(error as Error).message}`)
      this.scheduleReconnect()
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) {return}

    let isOpen = false

    // Connection timeout
    const connectionTimeout = setTimeout(() => {
      if (!isOpen && this.ws) {
        this.logger.error('WebSocket connection timeout')
        try {
          this.ws.close()
        } catch {
          // Ignore
        }
      }
    }, this.config.connectionTimeout)
    this.timers.push(connectionTimeout)

    this.ws.on('open', () => {
      clearTimeout(connectionTimeout)
      this.removeTimer(connectionTimeout)
      this.reconnectTimer = null
      isOpen = true
      this.isConnecting = false
      this.reconnectAttempt = 0
      this.logger.debug(`WebSocket connected (token: ${maskToken(this.loginResponse.id)})`)
    })

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.clearTimers()
      isOpen = false
      this.isConnecting = false

      const reasonStr = reason?.toString() || ''

      // Closed externally
      if (this.isClosed) {
        this.logger.debug('WebSocket closed by user')
        return
      }

      // Any non-user close means the live push channel is down.
      this.config.onConnectionChange?.(false)

      // Auth failure - don't reconnect. 401 is not a valid WebSocket close code
      // (codes are 1000-4999), so detect auth failures via the policy-violation
      // code (1008) or an auth-related close reason instead.
      if (code === 1008 || /unauth|forbidden|401|403/i.test(reasonStr)) {
        this.logger.warn(`WebSocket auth failed: ${code} ${reasonStr}`)
        return
      }

      // Remote normal closes still require reconnecting to preserve push updates.
      if (code === 1000) {
        this.logger.info('WebSocket closed normally by remote')
        this.scheduleReconnect()
        return
      }

      const codeDesc = CLOSE_CODES[code] || 'unknown'
      this.logger.info(`WebSocket closed: ${code} (${codeDesc})`)
      this.scheduleReconnect()
    })

    this.ws.on('error', (error: Error) => {
      clearTimeout(connectionTimeout)
      this.removeTimer(connectionTimeout)
      this.logger.error(`WebSocket error: ${error.message || 'Unknown error'}`)
    })

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.lastInboundAt = Date.now()
      this.handleMessage(data.toString())
    })

    // Pongs are inbound liveness too, even when no device updates are flowing.
    this.ws.on('pong', () => {
      this.lastInboundAt = Date.now()
    })
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: string): void {
    let data: Record<string, unknown>

    try {
      data = JSON.parse(message)
    } catch {
      this.logger.error(`Failed to parse WebSocket message: ${message}`)
      return
    }

    if (!data || typeof data !== 'object') {
      return
    }

    // Handle challenge - send FULL login response as token
    if (data.type === MessageType.CHALLENGE) {
      this.logger.debug(`Received challenge, responding with full login token`)
      // KEY: Send the entire login response object, not just the id!
      this.ws?.send(JSON.stringify({ token: this.loginResponse }))
      return
    }

    // Handle ready status
    if (data.type === MessageType.STATUS && data.status === STATUS_READY) {
      this.logger.info('WebSocket authenticated and ready')
      this.subscribeToDevices()
      this.startPing()
      this.config.onConnectionChange?.(true)
      return
    }

    // Handle notifications
    if (data.type === MessageType.NOTIFICATION) {
      this.handleNotification(data)
    }
  }

  /**
   * Subscribe to device updates
   */
  private subscribeToDevices(): void {
    this.logger.debug(`Subscribing to ${this.devices.length} device(s)`)
    for (const device of this.devices) {
      if (device?.id) {
        // Native WebSocket - no array wrapping needed
        this.ws?.send(JSON.stringify({
          type: 'subscribe',
          subscription: {
            modelName: 'IotSwitch',
            modelId: device.id,
          },
        }))
      }
    }
  }

  /**
   * Handle notification message
   */
  private handleNotification(data: Record<string, unknown>): void {
    const notification = data.notification as Record<string, unknown> | undefined
    if (!notification?.data || !notification.modelId) {
      return
    }

    const notificationData = notification.data as Record<string, unknown>
    
    // Build payload. Validate each field at this trust boundary before it flows
    // into HomeKit — a malformed frame must not push NaN/garbage into a
    // characteristic. Unrecognized or wrong-typed values are simply dropped.
    const payload: WebSocketPayload = {
      id: String(notification.modelId),
    }

    if (notificationData.power === 'ON' || notificationData.power === 'OFF') {
      payload.power = notificationData.power
    }

    if (
      typeof notificationData.brightness === 'number' &&
      Number.isFinite(notificationData.brightness)
    ) {
      payload.brightness = notificationData.brightness
    }

    if (typeof notificationData.occupancy === 'boolean') {
      payload.occupancy = notificationData.occupancy
    }

    if (typeof notificationData.motion === 'boolean') {
      payload.motion = notificationData.motion
    }

    // Only callback if we have meaningful data
    if (payload.power !== undefined || payload.brightness !== undefined || payload.occupancy !== undefined || payload.motion !== undefined) {
      this.logger.debug(`Device update: ${payload.id} power=${payload.power} brightness=${payload.brightness}`)
      this.callback(payload)
    }
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.isClosed) {return}
    if (this.reconnectTimer) {return}

    if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
      this.logger.warn(`WebSocket unavailable after ${this.config.maxReconnectAttempts} attempts`)
      return
    }

    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(2, this.reconnectAttempt),
      this.config.maxReconnectDelay,
    )

    this.logger.info(`WebSocket reconnecting in ${Math.round(delay / 1000)}s (${this.reconnectAttempt + 1}/${this.config.maxReconnectAttempts})`)

    const timer = setTimeout(() => {
      this.removeTimer(timer)
      this.reconnectTimer = null
      if (this.isClosed) {
        return
      }
      this.reconnectAttempt++
      this.connect()
    }, delay)

    this.reconnectTimer = timer
    this.timers.push(timer)
  }

  /**
   * Remove a timer from tracking
   */
  private removeTimer(timer: ReturnType<typeof setTimeout>): void {
    const index = this.timers.indexOf(timer)
    if (index !== -1) {
      this.timers.splice(index, 1)
    }
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer)
    }
    this.timers = []
    this.reconnectTimer = null
    
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
    }
    
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, this.config.pingInterval)
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    this.isClosed = true
    this.clearTimers()

    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore
      }
      this.ws = null
    }
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Get connection status
   */
  getStatus(): {
    isConnected: boolean
    isConnecting: boolean
    isClosed: boolean
    reconnectAttempt: number
    lastInboundAt: number | null
    lastEventAgeSec: number | null
    subscribed: number
  } {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      isClosed: this.isClosed,
      reconnectAttempt: this.reconnectAttempt,
      lastInboundAt: this.lastInboundAt,
      lastEventAgeSec:
        this.lastInboundAt === null ? null : Math.round((Date.now() - this.lastInboundAt) / 1000),
      subscribed: this.devices.length,
    }
  }
}

/**
 * Create and connect a WebSocket
 * 
 * @param loginResponse - The FULL login response from the API
 * @param devices - Array of devices to subscribe to
 * @param callback - Callback for device updates
 * @param logger - Logger instance
 * @param config - Optional configuration overrides
 */
export function createWebSocket(
  loginResponse: LoginResponse,
  devices: DeviceInfo[],
  callback: (payload: WebSocketPayload) => void,
  logger: WebSocketLogger | Logger,
  config?: Partial<WebSocketConfig>,
): LevitonWebSocket {
  const ws = new LevitonWebSocket(loginResponse, devices, callback, logger, config)
  ws.connect()
  return ws
}
