/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

// Create a mock SockJS class
class MockSockJS {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockSockJS[] = []
  static mockConstructor = jest.fn()

  onopen: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onmessage: ((ev: unknown) => void) | null = null
  readyState = 0
  send = jest.fn()
  close = jest.fn()

  constructor() {
    MockSockJS.mockConstructor()
    MockSockJS.instances.push(this)
  }

  setOpen() {
    this.readyState = MockSockJS.OPEN
  }

  setClosed() {
    this.readyState = MockSockJS.CLOSED
  }

  triggerOpen() {
    this.readyState = MockSockJS.OPEN
    if (this.onopen) {this.onopen({ type: 'open' })}
  }

  triggerClose(code = 1000, wasClean = true) {
    if (this.onclose) {
      this.onclose({ code, wasClean, reason: '' })
    }
  }

  triggerError(message = 'Connection error') {
    if (this.onerror) {
      this.onerror({ message })
    }
  }

  triggerMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  triggerRawMessage(data: string) {
    if (this.onmessage) {
      this.onmessage({ data })
    }
  }
}

// Mock the module before importing
jest.mock('sockjs-client', () => MockSockJS)

import { LevitonWebSocket, createWebSocket } from '../../src/api/websocket'

describe('LevitonWebSocket', () => {
  let mockCallback: jest.Mock
  let mockLogger: {
    debug: jest.Mock
    info: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }
  let devices: Array<{ id: string; name: string; serial: string; model: string }>

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    MockSockJS.instances = []
    MockSockJS.mockConstructor.mockClear()
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
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  const getLastMockInstance = () => MockSockJS.instances[MockSockJS.instances.length - 1]

  describe('constructor', () => {
    it('should create WebSocket with config', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      expect(ws).toBeDefined()
      ws.close()
    })

    it('should accept custom config', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
        { connectionTimeout: 5000, maxReconnectAttempts: 3 },
      )

      expect(ws).toBeDefined()
      ws.close()
    })
  })

  describe('updateToken', () => {
    it('should update the token', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      ws.updateToken('newtoken456')
      ws.close()
    })
  })

  describe('connect', () => {
    it('should create SockJS connection', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()

      expect(MockSockJS.mockConstructor).toHaveBeenCalled()
      ws.close()
    })

    it('should not connect if already connecting', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      ws.connect()

      expect(MockSockJS.mockConstructor).toHaveBeenCalledTimes(1)
      ws.close()
    })

    it('should not connect if closed', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      ws.close()
      ws.connect()

      expect(MockSockJS.mockConstructor).not.toHaveBeenCalled()
    })
  })

  describe('message handling', () => {
    it('should respond to challenge', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({ type: 'challenge' })

      expect(mock.send).toHaveBeenCalledWith(
        expect.stringContaining('token123'),
      )
      ws.close()
    })

    it('should subscribe to devices on ready', () => {
      const ws = new LevitonWebSocket(
        'token123',
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
      ws.close()
    })

    it('should call callback on notification with power data', () => {
      const ws = new LevitonWebSocket(
        'token123',
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

    it('should handle malformed messages', () => {
      const ws = new LevitonWebSocket(
        'token123',
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

    it('should ignore notifications without power data', () => {
      const ws = new LevitonWebSocket(
        'token123',
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

    it('should handle unknown message types', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerMessage({ type: 'unknown' })

      // Should log debug for unknown type
      expect(mockLogger.debug).toHaveBeenCalled()
      ws.close()
    })
  })

  describe('close handling', () => {
    it('should handle normal close', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(1000, true)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('closed'),
      )
    })

    it('should handle auth failure close', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(401, false)

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('auth'),
      )
    })

    it('should handle abnormal close with reconnect', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 2, initialReconnectDelay: 100 },
      )

      ws.connect()
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(1006, false) // Abnormal close

      // Should schedule reconnect
      expect(mockLogger.info).toHaveBeenCalled()
      ws.close()
    })
  })

  describe('error handling', () => {
    it('should log errors', () => {
      const ws = new LevitonWebSocket(
        'token123',
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
        'token123',
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
        'token123',
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
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      expect(ws.isConnected).toBe(false)
      ws.close()
    })

    it('should return true when connected and open', () => {
      const ws = new LevitonWebSocket(
        'token123',
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
        'token123',
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
        'token123',
        devices,
        mockCallback,
        mockLogger,
      )

      const status = ws.getStatus()

      expect(status).toHaveProperty('isConnected')
      expect(status).toHaveProperty('isConnecting')
      expect(status).toHaveProperty('isClosed')
      expect(status).toHaveProperty('reconnectAttempt')
    })
  })

  describe('connection timeout', () => {
    it('should timeout if connection not established', () => {
      const ws = new LevitonWebSocket(
        'token123',
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
        'token123',
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 3, initialReconnectDelay: 1000, maxReconnectDelay: 5000 },
      )

      ws.connect()
      expect(MockSockJS.mockConstructor).toHaveBeenCalledTimes(1)
      
      const mock = getLastMockInstance()
      mock.triggerOpen()
      mock.triggerClose(1006, false) // Abnormal close

      // Advance time for reconnect delay
      jest.advanceTimersByTime(1500)

      expect(MockSockJS.mockConstructor).toHaveBeenCalledTimes(2)
      ws.close()
    })

    it('should stop reconnecting after max attempts', () => {
      const ws = new LevitonWebSocket(
        'token123',
        devices,
        mockCallback,
        mockLogger,
        { maxReconnectAttempts: 2, initialReconnectDelay: 100, maxReconnectDelay: 200 },
      )

      // First connection
      ws.connect()
      expect(MockSockJS.mockConstructor).toHaveBeenCalledTimes(1)
      
      const mock1 = getLastMockInstance()
      mock1.triggerOpen()
      mock1.triggerClose(1006, false) // Abnormal close triggers reconnect

      // First reconnect attempt
      jest.advanceTimersByTime(150)
      expect(MockSockJS.mockConstructor).toHaveBeenCalledTimes(2)
      const mock2 = getLastMockInstance()
      mock2.triggerClose(1006, false) // Another failure

      // Second reconnect attempt
      jest.advanceTimersByTime(300)
      expect(MockSockJS.mockConstructor).toHaveBeenCalledTimes(3)
      const mock3 = getLastMockInstance()
      mock3.triggerClose(1006, false) // Another failure

      // No more reconnects should happen (max 2 attempts)
      jest.advanceTimersByTime(500)
      expect(MockSockJS.mockConstructor).toHaveBeenCalledTimes(3)

      // Should warn about max attempts
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed after'),
      )
      ws.close()
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

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    MockSockJS.instances = []
    MockSockJS.mockConstructor.mockClear()
    mockCallback = jest.fn()
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('should create and connect WebSocket', () => {
    const ws = createWebSocket(
      'token123',
      [{ id: 'dev1', name: 'Light', serial: 'SER', model: 'DW6HD' }],
      mockCallback,
      mockLogger,
    )

    expect(ws).toBeInstanceOf(LevitonWebSocket)
    expect(MockSockJS.mockConstructor).toHaveBeenCalled()
    ws.close()
  })
})
