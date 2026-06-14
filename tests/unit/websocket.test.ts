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

  constructor(_url: string, _options?: unknown) {
    super()
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

import { LevitonWebSocket, createWebSocket } from '../../src/api/websocket'
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
    it('notifies onConnectionChange(false) before reconnecting', () => {
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

      expect(onConnectionChange).toHaveBeenCalledWith(false)
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
      second.triggerClose(1006, '')
      jest.advanceTimersByTime(150)

      expect(MockWebSocket.mockConstructor).toHaveBeenCalledTimes(3)
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
