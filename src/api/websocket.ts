/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview WebSocket client for real-time device updates
 */

import SockJS from 'sockjs-client'
import { maskToken } from '../utils/sanitizers'
import type { WebSocketPayload, DeviceInfo, Logger } from '../types'

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  /** Socket URL */
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
 */
export const DEFAULT_WEBSOCKET_CONFIG: WebSocketConfig = {
  socketUrl: 'https://my.leviton.com/socket',
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
 */
export class LevitonWebSocket {
  private readonly config: WebSocketConfig
  private readonly logger: WebSocketLogger

  private ws: ReturnType<typeof SockJS> | null = null
  private token: string
  private devices: DeviceInfo[]
  private callback: (payload: WebSocketPayload) => void

  private reconnectAttempt = 0
  private timers: ReturnType<typeof setTimeout>[] = []
  private isConnecting = false
  private isClosed = false

  constructor(
    token: string,
    devices: DeviceInfo[],
    callback: (payload: WebSocketPayload) => void,
    logger: WebSocketLogger | Logger,
    config: Partial<WebSocketConfig> = {},
  ) {
    this.config = { ...DEFAULT_WEBSOCKET_CONFIG, ...config }
    this.logger = this.normalizeLogger(logger)
    this.token = token
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
   * Update token (after refresh)
   */
  updateToken(token: string): void {
    this.token = token
  }

  /**
   * Connect to WebSocket
   */
  connect(): void {
    if (this.isConnecting || this.isClosed) {
      return
    }

    this.isConnecting = true
    this.logger.debug('Connecting to WebSocket...')

    try {
      this.ws = new SockJS(this.config.socketUrl, undefined, {
        transports: ['websocket', 'xhr-streaming', 'xhr-polling'],
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

    this.ws.onopen = () => {
      clearTimeout(connectionTimeout)
      this.removeTimer(connectionTimeout)
      isOpen = true
      this.isConnecting = false
      this.reconnectAttempt = 0
      this.logger.debug(`WebSocket connected (token: ${maskToken(this.token)})`)
    }

    this.ws.onclose = (event: { code?: number; wasClean?: boolean }) => {
      this.clearTimers()
      isOpen = false
      this.isConnecting = false

      const code = event?.code
      const wasClean = event?.wasClean

      // Normal close
      if (wasClean && code === 1000) {
        this.logger.debug('WebSocket closed normally')
        return
      }

      // Auth failure - don't reconnect
      if (code === 401) {
        this.logger.info('WebSocket auth failed (expected - device control still works)')
        return
      }

      // Closed externally
      if (this.isClosed) {
        this.logger.debug('WebSocket closed by user')
        return
      }

      this.logger.debug(`WebSocket closed: code=${code} wasClean=${wasClean}`)
      this.scheduleReconnect()
    }

    this.ws.onerror = (error: { message?: string }) => {
      clearTimeout(connectionTimeout)
      this.removeTimer(connectionTimeout)
      this.logger.error(`WebSocket error: ${(error as Error).message || 'Unknown error'}`)
    }

    this.ws.onmessage = (message: { data: string }) => {
      this.handleMessage(message)
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: { data: string }): void {
    let data: Record<string, unknown>

    try {
      data = JSON.parse(message.data)
    } catch {
      this.logger.error(`Failed to parse WebSocket message: ${message.data}`)
      return
    }

    if (!data || typeof data !== 'object') {
      return
    }

    // Handle challenge
    if (data.type === MessageType.CHALLENGE) {
      this.logger.debug(`Received challenge, responding with token: ${maskToken(this.token)}`)
      this.ws?.send(JSON.stringify([{ token: this.token }]))
      return
    }

    // Handle ready status
    if (data.type === MessageType.STATUS && data.status === STATUS_READY) {
      this.logger.debug('WebSocket ready, subscribing to devices')
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
    for (const device of this.devices) {
      if (device?.id) {
        this.ws?.send(JSON.stringify([{
          type: 'subscribe',
          subscription: {
            modelName: 'IotSwitch',
            modelId: device.id,
          },
        }]))
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
    if (!notificationData.power) {
      return
    }

    const payload: WebSocketPayload = {
      id: notification.modelId as string,
      power: notificationData.power as 'ON' | 'OFF',
    }

    if (notificationData.brightness !== undefined) {
      payload.brightness = notificationData.brightness as number
    }

    if (notificationData.occupancy !== undefined) {
      payload.occupancy = notificationData.occupancy as boolean
    }

    this.callback(payload)
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
    return this.ws?.readyState === SockJS.OPEN
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
 */
export function createWebSocket(
  token: string,
  devices: DeviceInfo[],
  callback: (payload: WebSocketPayload) => void,
  logger: WebSocketLogger | Logger,
  config?: Partial<WebSocketConfig>,
): LevitonWebSocket {
  const ws = new LevitonWebSocket(token, devices, callback, logger, config)
  ws.connect()
  return ws
}

