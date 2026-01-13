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
  private timers: ReturnType<typeof setTimeout>[] = []
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
    this.config = { ...DEFAULT_WEBSOCKET_CONFIG, ...config }
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
    // Wrap basic logger
    const baseLogger = logger as Logger
    return {
      debug: (msg: string) => { baseLogger.info?.(`[debug] ${msg}`) ?? console.log(msg) },
      info: (msg: string) => { baseLogger.info?.(msg) ?? console.log(msg) },
      warn: (msg: string) => { baseLogger.warn?.(msg) ?? console.warn(msg) },
      error: (msg: string) => { baseLogger.error?.(msg) ?? console.error(msg) },
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
    if (this.isConnecting || this.isClosed) {
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

      // Normal close
      if (code === 1000) {
        this.logger.debug('WebSocket closed normally')
        return
      }

      // Auth failure - don't reconnect
      if (code === 401) {
        this.logger.warn(`WebSocket auth failed: ${reasonStr}`)
        return
      }

      // Closed externally
      if (this.isClosed) {
        this.logger.debug('WebSocket closed by user')
        return
      }

      this.logger.debug(`WebSocket closed: code=${code} reason=${reasonStr}`)
      this.scheduleReconnect()
    })

    this.ws.on('error', (error: Error) => {
      clearTimeout(connectionTimeout)
      this.removeTimer(connectionTimeout)
      this.logger.error(`WebSocket error: ${error.message || 'Unknown error'}`)
    })

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(data.toString())
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
    
    // Build payload - include power if present, but also handle other updates
    const payload: WebSocketPayload = {
      id: String(notification.modelId),
    }

    if (notificationData.power !== undefined) {
      payload.power = notificationData.power as 'ON' | 'OFF'
    }

    if (notificationData.brightness !== undefined) {
      payload.brightness = notificationData.brightness as number
    }

    if (notificationData.occupancy !== undefined) {
      payload.occupancy = notificationData.occupancy as boolean
    }

    // Only callback if we have meaningful data
    if (payload.power !== undefined || payload.brightness !== undefined || payload.occupancy !== undefined) {
      this.logger.debug(`Device update: ${payload.id} power=${payload.power} brightness=${payload.brightness}`)
      this.callback(payload)
    }
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.isClosed) {return}

    if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
      this.logger.warn(`WebSocket reconnection failed after ${this.config.maxReconnectAttempts} attempts`)
      return
    }

    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(2, this.reconnectAttempt),
      this.config.maxReconnectDelay,
    )

    this.logger.info(`WebSocket reconnecting in ${Math.round(delay / 1000)}s (${this.reconnectAttempt + 1}/${this.config.maxReconnectAttempts})`)

    const timer = setTimeout(() => {
      this.reconnectAttempt++
      this.connect()
    }, delay)

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
  } {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      isClosed: this.isClosed,
      reconnectAttempt: this.reconnectAttempt,
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
