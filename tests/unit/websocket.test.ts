/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

import { EventEmitter } from 'events'

// Create a mock WebSocket class that extends EventEmitter for event handling
class MockWebSocket extends EventEmitter {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []
  static mockConstructor = jest.fn()

  readyState = 0
  send = jest.fn()
  close = jest.fn()
  ping = jest.fn()
  terminate = jest.fn(() => this.triggerClose(1006, ''))

  options: { lookup?: (host: string, opts: object, cb: (...args: unknown[]) => void) => void } | undefined

  constructor(_url: string, options?: MockWebSocket['options']) {
    super()
    this.options = options
    MockWebSocket.mockConstructor()
    MockWebSocket.instances.push(this)
  }

  setOpen() {
    this.readyState = MockWebSocket.OPEN
  }

  setClosed() {
    this.readyState = MockWebSocket.CLOSED
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open')
  }

  triggerClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', code, Buffer.from(reason))
  }

  triggerError(message = 'Connection error') {
    this.emit('error', new Error(message))
  }

  triggerMessage(data: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(data)))
  }

  triggerRawMessage(data: string) {
    this.emit('message', Buffer.from(data))
  }
}

// Mock the ws module before importing
jest.mock('ws', () => MockWebSocket)

import { LevitonWebSocket, createWebSocket, formatDuration } from '../../src/api/websocket'
import type { LoginResponse } from '../../src/types'

describe('LevitonWebSocket', () => {
  let mockCallback: jest.Mock
  let mockLogger: {
    debug: jest.Mock
    info: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }
  let devices: Array<{ id: string; name: string; serial: string; model: string }>
  let loginResponse: LoginResponse

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    MockWebSocket.instances = []
    MockWebSocket.mockConstructor.mockClear()
    mockCallback = jest.fn()
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    devices = [
      { id: 'dev1', name: 'Light 1', serial: 'SER1', model: 'DW6HD' },
      { id: 'dev2', name: 'Light 2', serial: 'SER2', model: 'DW6HD' },
    ]
    // Full login response object as required by new implementation
    loginResponse = {
      id: 'token123',
      userId: 'user456',
      ttl: 1209600,
    }
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  const getLastMockInstance = () => MockWebSocket.instances[MockWebSocket.instances.length - 1]

  describe('constructor', () => {
    it('should create WebSocket with config', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      expect(ws).toBeDefined()
      ws.close()
    })

    it('should accept custom config', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { connectionTimeout: 5000, maxReconnectAttempts: 3 },
      )

      expect(ws).toBeDefined()
      ws.close()
    })
  })

  describe('updateLoginResponse', () => {
    it('should update the login response', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      const newLoginResponse = { id: 'newtoken456', userId: 'user789', ttl: 3600 }
      ws.updateLoginResponse(newLoginResponse)
      ws.close()
    })
  })

  describe('forceReconnect', () => {
    it('does not signal a disconnect for an intentional reconnect', () => {
      const onConnectionChange = jest.fn()
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { onConnectionChange },
      )

      ws.connect()
      getLastMockInstance().triggerOpen()
      onConnectionChange.mockClear()
      const instanceCountBefore = MockWebSocket.instances.length

      ws.forceReconnect()

      // No spurious offline flap on a deliberate reconnect (e.g. token refresh).
      expect(onConnectionChange).not.toHaveBeenCalledWith(false)
      // A fresh socket is opened to pick up the new credentials.
      expect(MockWebSocket.instances.length).toBe(instanceCountBefore + 1)
      ws.close()
    })

    it('reports a disconnect only if the reconnect actually fails', () => {
      const onConnectionChange = jest.fn()
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { onConnectionChange },
      )

      ws.connect()
      getLastMockInstance().triggerOpen()
      onConnectionChange.mockClear()

      ws.forceReconnect()
      // The new socket closes unexpectedly -> normal close handler reports offline.
      getLastMockInstance().triggerClose(1006, 'abnormal')

      expect(onConnectionChange).toHaveBeenCalledWith(false)
      ws.close()
    })

    it('survives the error that closing a still-connecting socket emits', () => {
      const ws = new LevitonWebSocket(loginResponse, devices, mockCallback, mockLogger)

      ws.connect()
      const connecting = getLastMockInstance()

      ws.forceReconnect()

      // ws emits 'error' on the next tick when close() aborts a handshake. An
      // 'error' with no listener throws, which would crash Homebridge.
      expect(() => connecting.emit('error', new Error('WebSocket was closed before the connection was established'))).not.toThrow()
      ws.close()
    })
  })

  describe('updateToken (legacy)', () => {
    it('should update the token id', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.updateToken('newtoken456')
      ws.close()
    })
  })

  describe('connect', () => {
    it('should create WebSocket connection', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()

      expect(MockWebSocket.mockConstructor).toHaveBeenCalled()
      ws.close()
    })

    it('should not connect if already connecting', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      ws.connect()

      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(1)
      ws.close()
    })

    it('should not connect if closed', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.close()
      ws.connect()

      expect(MockWebSocket.mockConstructor).not.toHaveBeenCalled()
    })
  })

  describe('message handling', () => {
    it('should respond to challenge with full login response', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({ type: 'challenge' })

      // Should send full login response as token
      expect(mock.send).toHaveBeenCalledWith(
        expect.stringContaining('"token"'),
      )
      expect(mock.send).toHaveBeenCalledWith(
        expect.stringContaining('token123'),
      )
      expect(mock.send).toHaveBeenCalledWith(
        expect.stringContaining('user456'),
      )
      ws.close()
    })

    it('should subscribe to devices on ready', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({ type: 'status', status: 'ready' })

      // Should subscribe to each device
      expect(mock.send).toHaveBeenCalledTimes(2)
      expect(mock.send).toHaveBeenCalledWith(
        expect.stringContaining('subscribe'),
      )
      ws.close()
    })

    it('should call callback on notification with power data', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({
        type: 'notification',
        notification: {
          modelId: 'dev1',
          data: { power: 'ON', brightness: 75 },
        },
      })

      expect(mockCallback).toHaveBeenCalledWith({
        id: 'dev1',
        power: 'ON',
        brightness: 75,
      })
      ws.close()
    })

    it('should drop invalid field types from a notification payload', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      // power is a valid value, but brightness/occupancy/motion are the wrong
      // types and must be dropped rather than pushed into HomeKit.
      mock.triggerMessage({
        type: 'notification',
        notification: {
          modelId: 'dev1',
          data: { power: 'ON', brightness: 'bright', occupancy: 'yes', motion: 1 },
        },
      })

      expect(mockCallback).toHaveBeenCalledWith({ id: 'dev1', power: 'ON' })
      ws.close()
    })

    it('should pass a valid lastUpdated as epoch ms and drop an invalid one', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({
        type: 'notification',
        notification: { modelId: 'dev1', data: { power: 'ON', lastUpdated: '2026-01-01T00:00:10.500Z' } },
      })
      mock.triggerMessage({
        type: 'notification',
        notification: { modelId: 'dev1', data: { power: 'OFF', lastUpdated: 'yesterday' } },
      })

      expect(mockCallback).toHaveBeenNthCalledWith(1, {
        id: 'dev1',
        power: 'ON',
        lastUpdated: Date.parse('2026-01-01T00:00:10.500Z'),
      })
      expect(mockCallback).toHaveBeenNthCalledWith(2, { id: 'dev1', power: 'OFF' })
      ws.close()
    })

    describe('frame sender and change reason', () => {
      const SWITCH_DST = { dstStart: 1700000000, dstEnd: 1700040000, dstOffset: 60 }
      const CLOUD_DST = { dstStart: 0, dstEnd: 0, dstOffset: 0 }
      const deliver = (data: object): void => {
        const ws = new LevitonWebSocket(loginResponse, devices, mockCallback, mockLogger)
        ws.connect()
        const mock = getLastMockInstance()
        mock.triggerOpen()
        mock.triggerMessage({ type: 'notification', notification: { modelId: 'dev1', data } })
        ws.close()
      }

      it('marks a cloud command by its zeroed DST fields, with or without a client_id', () => {
        deliver({ power: 'ON', ...CLOUD_DST })
        deliver({ power: 'OFF', client_id: 'test-client', client_secret: 'test-secret', ...CLOUD_DST })

        expect(mockCallback).toHaveBeenNthCalledWith(1, { id: 'dev1', power: 'ON', sender: 'cloud' })
        expect(mockCallback).toHaveBeenNthCalledWith(2, { id: 'dev1', power: 'OFF', sender: 'cloud', hasClientId: true })
      })

      it('marks a switch report by rssi, chgReason, or real DST dates, and passes chgReason on', () => {
        deliver({ power: 'ON', rssi: -60, chgReason: 1, ...SWITCH_DST })
        deliver({ power: 'ON', brightness: 30, chgReason: 3, ...SWITCH_DST })
        deliver({ power: 'OFF', ...SWITCH_DST })
        deliver({ power: 'OFF', rssi: -60 })

        expect(mockCallback.mock.calls.map(([payload]) => payload)).toEqual([
          { id: 'dev1', power: 'ON', sender: 'switch', changeReason: 1 },
          { id: 'dev1', power: 'ON', brightness: 30, sender: 'switch', changeReason: 3 },
          { id: 'dev1', power: 'OFF', sender: 'switch' },
          { id: 'dev1', power: 'OFF', sender: 'switch' },
        ])
      })

      it('leaves the sender out when the frame shows none, and drops a non-integer chgReason', () => {
        deliver({ power: 'ON' })
        deliver({ power: 'OFF', chgReason: '3', ...SWITCH_DST })
        deliver({ power: 'ON', chgReason: 1.5, ...SWITCH_DST })

        expect(mockCallback.mock.calls.map(([payload]) => payload)).toEqual([
          { id: 'dev1', power: 'ON' },
          { id: 'dev1', power: 'OFF', sender: 'switch' },
          { id: 'dev1', power: 'ON', sender: 'switch' },
        ])
      })

      it('ignores a switch report that carries no state', () => {
        deliver({ rssi: -60, chgReason: 3, ...SWITCH_DST })

        expect(mockCallback).not.toHaveBeenCalled()
      })

      it('shows the sender and change reason in the debug line', () => {
        deliver({ power: 'ON', brightness: 30, chgReason: 3, ...SWITCH_DST })

        expect(mockLogger.debug).toHaveBeenCalledWith('Device update: dev1 power=ON brightness=30 sender=switch changeReason=3')
      })
    })

    it('should ignore a payload whose only fields are invalid', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({
        type: 'notification',
        notification: {
          modelId: 'dev1',
          data: { brightness: NaN, power: 'MAYBE' },
        },
      })

      expect(mockCallback).not.toHaveBeenCalled()
      ws.close()
    })

    it('should handle malformed messages', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerRawMessage('not json')

      expect(mockLogger.error).toHaveBeenCalled()
      ws.close()
    })

    it('should ignore notifications without meaningful data', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({
        type: 'notification',
        notification: {
          modelId: 'dev1',
          data: { other: 'data' },
        },
      })

      expect(mockCallback).not.toHaveBeenCalled()
      ws.close()
    })

    it('should call callback for brightness-only updates', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({
        type: 'notification',
        notification: {
          modelId: 'dev1',
          data: { brightness: 50 },
        },
      })

      expect(mockCallback).toHaveBeenCalledWith({
        id: 'dev1',
        brightness: 50,
      })
      ws.close()
    })

    it('should call callback on notification with motion data', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({
        type: 'notification',
        notification: {
          modelId: 'dev1',
          data: { motion: true },
        },
      })

      expect(mockCallback).toHaveBeenCalledWith({
        id: 'dev1',
        motion: true,
      })
      ws.close()
    })

    it('should call callback on notification with occupancy and motion data', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({
        type: 'notification',
        notification: {
          modelId: 'dev1',
          data: { occupancy: true, motion: false },
        },
      })

      expect(mockCallback).toHaveBeenCalledWith({
        id: 'dev1',
        occupancy: true,
        motion: false,
      })
      ws.close()
    })

    it('should handle unknown message types gracefully', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({ type: 'unknown' })

      // Should not crash, callback should not be called
      expect(mockCallback).not.toHaveBeenCalled()
      ws.close()
    })
  })

  describe('close handling', () => {
    it('should reconnect after remote normal close', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 2, initialReconnectDelay: 100 },
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(1000, '')

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('closed normally'),
      )
      jest.advanceTimersByTime(150)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(2)
      ws.close()
    })

    it('should handle auth failure close', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(401, 'Unauthorized')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('auth'),
      )
      ws.close()
    })

    it('retries on the slow schedule after an auth close instead of giving up', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectDelay: 60000 },
      )

      ws.connect()
      const first = getLastMockInstance()
      first.triggerOpen()
      first.triggerClose(1008, 'Unauthorized')

      jest.advanceTimersByTime(59000)
      expect(MockWebSocket.instances).toHaveLength(1)
      jest.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)

      // A second auth close in a row is logged quietly so a revoked token
      // does not warn every minute.
      mockLogger.warn.mockClear()
      const second = getLastMockInstance()
      second.triggerOpen()
      second.triggerClose(1008, 'Unauthorized')
      expect(mockLogger.warn).not.toHaveBeenCalled()
      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('auth failed'))
      jest.advanceTimersByTime(60000)
      expect(MockWebSocket.instances).toHaveLength(3)
      ws.close()
    })

    it('should handle abnormal close with reconnect', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 2, initialReconnectDelay: 100 },
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(1006, '') // Abnormal close

      // Should schedule reconnect
      expect(mockLogger.info).toHaveBeenCalled()
      ws.close()
    })
  })

  describe('error handling', () => {
    it('should log errors', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerError('Connection failed')

      expect(mockLogger.error).toHaveBeenCalled()
      ws.close()
    })
  })

  describe('close', () => {
    it('should close the connection', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      ws.close()

      expect(mock.close).toHaveBeenCalled()
    })

    it('should handle close when not connected', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      // Close without connecting - no error means success
      ws.close()
    })
  })

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      expect(ws.isConnected).toBe(false)
      ws.close()
    })

    it('should return true when connected and open', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen() // This sets readyState to OPEN
      
      expect(ws.isConnected).toBe(true)
      ws.close()
    })

    it('should return false when connecting but not open', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      // Don't trigger open - socket is still connecting
      
      expect(ws.isConnected).toBe(false)
      ws.close()
    })
  })

  describe('getStatus', () => {
    it('should return status', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      const status = ws.getStatus()

      expect(status).toHaveProperty('isConnected')
      expect(status).toHaveProperty('isConnecting')
      expect(status).toHaveProperty('isClosed')
      expect(status).toHaveProperty('reconnectAttempt')
      expect(status).toHaveProperty('lastInboundAt')
      expect(status).toHaveProperty('lastEventAgeSec')
      expect(status).toHaveProperty('subscribed')
    })

    it('reports null liveness before any inbound frame and the subscribed count', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      const status = ws.getStatus()
      expect(status.lastInboundAt).toBeNull()
      expect(status.lastEventAgeSec).toBeNull()
      expect(status.subscribed).toBe(devices.length)
      ws.close()
    })

    it('updates lastInboundAt when a message arrives', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({ type: 'status', status: 'ready' })

      const status = ws.getStatus()
      expect(typeof status.lastInboundAt).toBe('number')
      expect(status.lastEventAgeSec).not.toBeNull()
      expect(status.lastEventAgeSec).toBeGreaterThanOrEqual(0)
      ws.close()
    })

    it('updates lastInboundAt when a pong arrives', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      expect(ws.getStatus().lastInboundAt).toBeNull()

      mock.emit('pong')

      expect(typeof ws.getStatus().lastInboundAt).toBe('number')
      ws.close()
    })
  })

  describe('connection timeout', () => {
    it('should timeout if connection not established', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { connectionTimeout: 1000 },
      )

      ws.connect()
      // Don't trigger open
      
      jest.advanceTimersByTime(1500)

      expect(mockLogger.error).toHaveBeenCalledWith('WebSocket connection timeout')
      ws.close()
    })

    it('reconnects when the socket opens but the server never says ready', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { connectionTimeout: 1000, initialReconnectDelay: 100 },
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()

      jest.advanceTimersByTime(1000)
      expect(mock.terminate).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(200)
      expect(MockWebSocket.instances).toHaveLength(2)
      ws.close()
    })

    it('leaves a ready socket alone when the connect timeout would have run', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { connectionTimeout: 1000, pingInterval: 60000 },
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({ type: 'status', status: 'ready' })

      jest.advanceTimersByTime(5000)
      expect(mock.terminate).not.toHaveBeenCalled()
      expect(mock.close).not.toHaveBeenCalled()
      ws.close()
    })

    it('logs the error from closing a connecting socket quietly on shutdown', () => {
      const ws = new LevitonWebSocket(loginResponse, devices, mockCallback, mockLogger)

      ws.connect()
      const mock = getLastMockInstance()
      ws.close()
      mock.triggerError('WebSocket was closed before the connection was established')

      expect(mockLogger.error).not.toHaveBeenCalled()
    })
  })

  describe('reconnection', () => {
    it('should reconnect after abnormal close', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 3, initialReconnectDelay: 1000, maxReconnectDelay: 5000 },
      )

      ws.connect()
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(1)
      
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(1006, '') // Abnormal close

      // Advance time for reconnect delay
      jest.advanceTimersByTime(1500)

      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(2)
      ws.close()
    })

    it('should schedule long-tail reconnect after max attempts', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 2, initialReconnectDelay: 100, maxReconnectDelay: 200 },
      )

      // First connection
      ws.connect()
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(1)
      
      const mock1 = getLastMockInstance()
      mock1.triggerOpen()
      mock1.triggerClose(1006, '') // Abnormal close triggers reconnect

      // First reconnect attempt
      jest.advanceTimersByTime(150)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(2)
      const mock2 = getLastMockInstance()
      mock2.triggerClose(1006, '') // Another failure

      // Second reconnect attempt
      jest.advanceTimersByTime(300)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(3)
      const mock3 = getLastMockInstance()
      mock3.triggerClose(1006, '') // Another failure — hits max attempts

      // Long-tail retry after cooldown (maxReconnectDelay)
      jest.advanceTimersByTime(200)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(4)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('long-tail retry'),
      )
      ws.close()
    })

    it('should schedule only one reconnect for repeated close/error sequences', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 3, initialReconnectDelay: 100, maxReconnectDelay: 1000 },
      )

      ws.connect()
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(1)

      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerError('socket error')
      mock.triggerClose(1006, '')
      mock.triggerClose(1006, '')

      jest.advanceTimersByTime(150)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(2)
      ws.close()
    })

    it('should reset reconnect scheduling after successful reconnection', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 3, initialReconnectDelay: 100, maxReconnectDelay: 1000 },
      )

      ws.connect()
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(1)

      const first = getLastMockInstance()
      first.triggerOpen()
      first.triggerClose(1006, '')
      jest.advanceTimersByTime(150)

      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(2)
      const second = getLastMockInstance()
      second.triggerOpen()
      second.triggerMessage({ type: 'status', status: 'ready' })
      second.triggerClose(1006, '')
      jest.advanceTimersByTime(150)

      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(3)
      ws.close()
    })

    it('keeps backing off when the socket opens but drops before ready', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 5, initialReconnectDelay: 100, maxReconnectDelay: 10000 },
      )

      ws.connect()
      const first = getLastMockInstance()
      first.triggerOpen()
      first.triggerClose(1006, '')
      jest.advanceTimersByTime(150)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(2)

      const second = getLastMockInstance()
      second.triggerOpen()
      second.triggerClose(1006, '')
      // Second attempt backs off to ~200ms instead of resetting to ~100ms.
      jest.advanceTimersByTime(150)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(2)
      jest.advanceTimersByTime(100)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(3)
      ws.close()
    })
  })

  describe('liveness watchdog', () => {
    const connectReady = (ws: LevitonWebSocket) => {
      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({ type: 'status', status: 'ready' })
      return mock
    }

    it('pings while the server keeps answering', () => {
      const ws = new LevitonWebSocket(loginResponse, devices, mockCallback, mockLogger, { pingInterval: 1000 })
      const mock = connectReady(ws)

      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(1000)
        mock.emit('pong')
      }

      expect(mock.ping).toHaveBeenCalledTimes(5)
      expect(mock.terminate).not.toHaveBeenCalled()
      ws.close()
    })

    it('treats server-initiated pings as liveness', () => {
      const ws = new LevitonWebSocket(loginResponse, devices, mockCallback, mockLogger, { pingInterval: 1000 })
      const mock = connectReady(ws)

      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(1000)
        mock.emit('ping')
      }

      expect(mock.terminate).not.toHaveBeenCalled()
      ws.close()
    })

    it('terminates and reconnects after two silent ping cycles', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { pingInterval: 1000, initialReconnectDelay: 100 },
      )
      const mock = connectReady(ws)

      jest.advanceTimersByTime(2000)
      expect(mock.terminate).not.toHaveBeenCalled()
      jest.advanceTimersByTime(1000)
      expect(mock.terminate).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('silent'))

      jest.advanceTimersByTime(150)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(2)
      ws.close()
    })

    it('should cancel pending reconnect when closed by user', () => {
      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 3, initialReconnectDelay: 100, maxReconnectDelay: 1000 },
      )

      ws.connect()
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(1)

      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(1006, '')
      ws.close()

      jest.advanceTimersByTime(500)
      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(1)
    })
  })

  describe('logger normalization', () => {
    type LoggerArg = ConstructorParameters<typeof LevitonWebSocket>[3]

    it('does not double-log when wrapping a partial logger (only info)', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
      const baseInfo = jest.fn()

      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        { info: baseInfo } as unknown as LoggerArg,
      )

      // connect() emits a debug log through the normalized logger
      ws.connect()

      expect(baseInfo).toHaveBeenCalledTimes(1)
      expect(baseInfo).toHaveBeenCalledWith(expect.stringContaining('[debug]'))
      expect(consoleSpy).not.toHaveBeenCalled()

      ws.close()
      consoleSpy.mockRestore()
    })

    it('falls back to console when the base method is absent', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

      const ws = new LevitonWebSocket(
        loginResponse,
        devices,
        mockCallback,
        { warn: jest.fn() } as unknown as LoggerArg,
      )

      ws.connect()

      // No base `info`, so the debug log routes to console.log exactly once
      expect(consoleSpy).toHaveBeenCalledTimes(1)

      ws.close()
      consoleSpy.mockRestore()
    })
  })
})

describe('createWebSocket', () => {
  let mockCallback: jest.Mock
  let mockLogger: {
    debug: jest.Mock
    info: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }
  let loginResponse: LoginResponse

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    MockWebSocket.instances = []
    MockWebSocket.mockConstructor.mockClear()
    mockCallback = jest.fn()
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    loginResponse = {
      id: 'token123',
      userId: 'user456',
      ttl: 1209600,
    }
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('should create and connect WebSocket', () => {
    const ws = createWebSocket(
      loginResponse,
      [{ id: 'dev1', name: 'Light', serial: 'SER', model: 'DW6HD' }],
      mockCallback,
      mockLogger,
    )

    expect(ws).toBeInstanceOf(LevitonWebSocket)
    expect(MockWebSocket.mockConstructor).toHaveBeenCalled()
    ws.close()
  })
})

describe('LevitonWebSocket load balancer logging', () => {
  const login: LoginResponse = { id: 'token123', userId: 'user456', ttl: 1209600 }
  let logger: { debug: jest.Mock; info: jest.Mock; warn: jest.Mock; error: jest.Mock }

  beforeEach(() => {
    MockWebSocket.instances = []
    logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  })

  const infoLines = () => logger.info.mock.calls.map(call => String(call[0]))
  const debugLines = () => logger.debug.mock.calls.map(call => String(call[0]))
  const lastSocket = () => MockWebSocket.instances[MockWebSocket.instances.length - 1]
  const runLookup = (opts: object = {}) => new Promise<unknown[]>(resolve => {
    lastSocket().options?.lookup?.('my.leviton.com', opts, (...args: unknown[]) => resolve(args))
  })
  const addrs = (...list: string[]) => list.map(address => ({ address, family: 4 }))

  it('adds the connection length to the close line', () => {
    const ws = new LevitonWebSocket(login, [], jest.fn(), logger)
    ws.connect()
    lastSocket().triggerOpen()
    lastSocket().triggerClose(1006)

    expect(infoLines()).toContainEqual(expect.stringMatching(/^WebSocket closed: 1006 \(connection dropped\) after \d+s$/))
    ws.close()
  })

  it('leaves the length off when the socket never opened', () => {
    const ws = new LevitonWebSocket(login, [], jest.fn(), logger)
    ws.connect()
    lastSocket().triggerClose(1006)

    expect(infoLines()).toContain('WebSocket closed: 1006 (connection dropped)')
    ws.close()
  })

  it('logs the server and DNS addresses at debug on connect', async () => {
    const resolveAll = jest.fn().mockResolvedValue(addrs('192.0.2.11', '192.0.2.10'))
    const ws = new LevitonWebSocket(login, [], jest.fn(), logger, { resolveAll })
    ws.connect()
    await expect(runLookup()).resolves.toEqual([null, '192.0.2.11', 4])
    lastSocket().emit('upgrade', { socket: { remoteAddress: '192.0.2.11' } })
    lastSocket().triggerOpen()

    expect(debugLines()).toContain('WebSocket server: 192.0.2.11 (DNS: 192.0.2.10, 192.0.2.11)')
    expect(infoLines().some(line => line.startsWith('Load balancer'))).toBe(false)
    ws.close()
  })

  it('logs one line when the addresses change between connections', async () => {
    const resolveAll = jest.fn()
      .mockResolvedValueOnce(addrs('192.0.2.10', '192.0.2.11'))
      .mockResolvedValueOnce(addrs('192.0.2.21', '192.0.2.20'))
    const ws = new LevitonWebSocket(login, [], jest.fn(), logger, { resolveAll })
    ws.connect()
    await runLookup()
    ws.forceReconnect()
    await runLookup()

    expect(infoLines().filter(line => line.startsWith('Load balancer'))).toEqual([
      'Load balancer addresses changed: 192.0.2.20, 192.0.2.21 (was 192.0.2.10, 192.0.2.11)',
    ])
    ws.close()
  })

  it('logs nothing when the same addresses come back in a different order', async () => {
    const resolveAll = jest.fn()
      .mockResolvedValueOnce(addrs('192.0.2.10', '192.0.2.11'))
      .mockResolvedValueOnce(addrs('192.0.2.11', '192.0.2.10'))
    const ws = new LevitonWebSocket(login, [], jest.fn(), logger, { resolveAll })
    ws.connect()
    await runLookup()
    ws.forceReconnect()
    await runLookup()

    expect(infoLines().some(line => line.startsWith('Load balancer'))).toBe(false)
    ws.close()
  })

  it('ignores a lookup that finishes after a newer connection started', async () => {
    let finishStale: (value: Array<{ address: string; family: number }>) => void = () => {}
    const resolveAll = jest.fn()
      .mockResolvedValue(addrs('192.0.2.10', '192.0.2.11'))
      .mockResolvedValueOnce(addrs('192.0.2.10', '192.0.2.11'))
      .mockReturnValueOnce(new Promise(resolve => { finishStale = resolve }))
      .mockResolvedValueOnce(addrs('192.0.2.10', '192.0.2.11'))
    const ws = new LevitonWebSocket(login, [], jest.fn(), logger, { resolveAll })
    ws.connect()
    await runLookup()
    ws.forceReconnect()
    const staleLookup = runLookup()
    ws.forceReconnect()
    await runLookup()
    finishStale(addrs('192.0.2.20', '192.0.2.21'))
    await staleLookup
    ws.forceReconnect()
    await runLookup()

    expect(infoLines().some(line => line.startsWith('Load balancer'))).toBe(false)
    ws.close()
  })

  it('returns every address when the socket asks for all of them', async () => {
    const resolveAll = jest.fn().mockResolvedValue(addrs('192.0.2.10', '192.0.2.11'))
    const ws = new LevitonWebSocket(login, [], jest.fn(), logger, { resolveAll })
    ws.connect()

    await expect(runLookup({ all: true })).resolves.toEqual([null, addrs('192.0.2.10', '192.0.2.11')])
    ws.close()
  })

  it('passes lookup errors to the socket without logging', async () => {
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND my.leviton.com'), { code: 'ENOTFOUND' })
    const resolveAll = jest.fn().mockRejectedValue(error)
    const ws = new LevitonWebSocket(login, [], jest.fn(), logger, { resolveAll })
    ws.connect()

    await expect(runLookup()).resolves.toEqual([error, ''])
    expect(infoLines()).toEqual([])
    ws.close()
  })

  it('formats durations', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(725_000)).toBe('12m 5s')
    expect(formatDuration(11_520_000)).toBe('3h 12m')
  })
})
