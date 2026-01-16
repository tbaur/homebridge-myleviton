"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LevitonWebSocket = exports.DEFAULT_WEBSOCKET_CONFIG = void 0;
exports.createWebSocket = createWebSocket;
const ws_1 = __importDefault(require("ws"));
const sanitizers_1 = require("../utils/sanitizers");
/**
 * Default WebSocket configuration
 * Note: Uses native WebSocket endpoint, NOT SockJS
 */
exports.DEFAULT_WEBSOCKET_CONFIG = {
    socketUrl: 'wss://my.leviton.com/socket/websocket',
    connectionTimeout: 10000,
    maxReconnectAttempts: 10,
    initialReconnectDelay: 1000,
    maxReconnectDelay: 60000,
    pingInterval: 30000, // Send ping every 30 seconds
};
/**
 * WebSocket message types
 */
var MessageType;
(function (MessageType) {
    MessageType["CHALLENGE"] = "challenge";
    MessageType["STATUS"] = "status";
    MessageType["NOTIFICATION"] = "notification";
})(MessageType || (MessageType = {}));
/**
 * WebSocket status values
 */
const STATUS_READY = 'ready';
/**
 * WebSocket close code descriptions
 */
const CLOSE_CODES = {
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
};
/**
 * WebSocket connection for real-time updates
 *
 * Uses native WebSocket (not SockJS) and sends full login response for auth.
 */
class LevitonWebSocket {
    config;
    logger;
    ws = null;
    loginResponse;
    devices;
    callback;
    reconnectAttempt = 0;
    timers = [];
    pingTimer = null;
    isConnecting = false;
    isClosed = false;
    /**
     * Create a new WebSocket connection
     *
     * @param loginResponse - The FULL login response from the API (not just the token id!)
     * @param devices - Array of devices to subscribe to
     * @param callback - Callback for device updates
     * @param logger - Logger instance
     * @param config - Optional configuration overrides
     */
    constructor(loginResponse, devices, callback, logger, config = {}) {
        this.config = { ...exports.DEFAULT_WEBSOCKET_CONFIG, ...config };
        this.logger = this.normalizeLogger(logger);
        this.loginResponse = loginResponse;
        this.devices = devices;
        this.callback = callback;
    }
    /**
     * Normalize logger to standard interface
     */
    normalizeLogger(logger) {
        if ('debug' in logger && 'info' in logger && 'warn' in logger && 'error' in logger) {
            return logger;
        }
        // Wrap basic logger
        const baseLogger = logger;
        return {
            debug: (msg) => { baseLogger.info?.(`[debug] ${msg}`) ?? console.log(msg); },
            info: (msg) => { baseLogger.info?.(msg) ?? console.log(msg); },
            warn: (msg) => { baseLogger.warn?.(msg) ?? console.warn(msg); },
            error: (msg) => { baseLogger.error?.(msg) ?? console.error(msg); },
        };
    }
    /**
     * Update login response (after token refresh)
     *
     * @param loginResponse - The new full login response
     */
    updateLoginResponse(loginResponse) {
        this.loginResponse = loginResponse;
    }
    /**
     * Legacy method for compatibility - prefer updateLoginResponse
     * @deprecated Use updateLoginResponse instead
     */
    updateToken(token) {
        // For backward compatibility, update just the id
        // But ideally callers should use updateLoginResponse with full object
        this.loginResponse = { ...this.loginResponse, id: token };
    }
    /**
     * Connect to WebSocket
     */
    connect() {
        if (this.isConnecting || this.isClosed || this.isConnected) {
            return;
        }
        this.isConnecting = true;
        this.logger.debug(`Connecting to WebSocket: ${this.config.socketUrl}`);
        try {
            // Native WebSocket with required headers
            this.ws = new ws_1.default(this.config.socketUrl, {
                headers: {
                    'Origin': 'https://my.leviton.com',
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache',
                },
            });
            this.setupEventHandlers();
        }
        catch (error) {
            this.isConnecting = false;
            this.logger.error(`Failed to create WebSocket: ${error.message}`);
            this.scheduleReconnect();
        }
    }
    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        if (!this.ws) {
            return;
        }
        let isOpen = false;
        // Connection timeout
        const connectionTimeout = setTimeout(() => {
            if (!isOpen && this.ws) {
                this.logger.error('WebSocket connection timeout');
                try {
                    this.ws.close();
                }
                catch {
                    // Ignore
                }
            }
        }, this.config.connectionTimeout);
        this.timers.push(connectionTimeout);
        this.ws.on('open', () => {
            clearTimeout(connectionTimeout);
            this.removeTimer(connectionTimeout);
            isOpen = true;
            this.isConnecting = false;
            this.reconnectAttempt = 0;
            this.logger.debug(`WebSocket connected (token: ${(0, sanitizers_1.maskToken)(this.loginResponse.id)})`);
        });
        this.ws.on('close', (code, reason) => {
            this.clearTimers();
            isOpen = false;
            this.isConnecting = false;
            const reasonStr = reason?.toString() || '';
            // Normal close
            if (code === 1000) {
                this.logger.debug('WebSocket closed normally');
                return;
            }
            // Auth failure - don't reconnect
            if (code === 401) {
                this.logger.warn(`WebSocket auth failed: ${reasonStr}`);
                return;
            }
            // Closed externally
            if (this.isClosed) {
                this.logger.debug('WebSocket closed by user');
                return;
            }
            const codeDesc = CLOSE_CODES[code] || 'unknown';
            this.logger.info(`WebSocket closed: ${code} (${codeDesc})`);
            this.scheduleReconnect();
        });
        this.ws.on('error', (error) => {
            clearTimeout(connectionTimeout);
            this.removeTimer(connectionTimeout);
            this.logger.error(`WebSocket error: ${error.message || 'Unknown error'}`);
        });
        this.ws.on('message', (data) => {
            this.handleMessage(data.toString());
        });
    }
    /**
     * Handle incoming message
     */
    handleMessage(message) {
        let data;
        try {
            data = JSON.parse(message);
        }
        catch {
            this.logger.error(`Failed to parse WebSocket message: ${message}`);
            return;
        }
        if (!data || typeof data !== 'object') {
            return;
        }
        // Handle challenge - send FULL login response as token
        if (data.type === MessageType.CHALLENGE) {
            this.logger.debug(`Received challenge, responding with full login token`);
            // KEY: Send the entire login response object, not just the id!
            this.ws?.send(JSON.stringify({ token: this.loginResponse }));
            return;
        }
        // Handle ready status
        if (data.type === MessageType.STATUS && data.status === STATUS_READY) {
            this.logger.info('WebSocket authenticated and ready');
            this.subscribeToDevices();
            this.startPing();
            return;
        }
        // Handle notifications
        if (data.type === MessageType.NOTIFICATION) {
            this.handleNotification(data);
        }
    }
    /**
     * Subscribe to device updates
     */
    subscribeToDevices() {
        this.logger.debug(`Subscribing to ${this.devices.length} device(s)`);
        for (const device of this.devices) {
            if (device?.id) {
                // Native WebSocket - no array wrapping needed
                this.ws?.send(JSON.stringify({
                    type: 'subscribe',
                    subscription: {
                        modelName: 'IotSwitch',
                        modelId: device.id,
                    },
                }));
            }
        }
    }
    /**
     * Handle notification message
     */
    handleNotification(data) {
        const notification = data.notification;
        if (!notification?.data || !notification.modelId) {
            return;
        }
        const notificationData = notification.data;
        // Build payload - include power if present, but also handle other updates
        const payload = {
            id: String(notification.modelId),
        };
        if (notificationData.power !== undefined) {
            payload.power = notificationData.power;
        }
        if (notificationData.brightness !== undefined) {
            payload.brightness = notificationData.brightness;
        }
        if (notificationData.occupancy !== undefined) {
            payload.occupancy = notificationData.occupancy;
        }
        // Only callback if we have meaningful data
        if (payload.power !== undefined || payload.brightness !== undefined || payload.occupancy !== undefined) {
            this.logger.debug(`Device update: ${payload.id} power=${payload.power} brightness=${payload.brightness}`);
            this.callback(payload);
        }
    }
    /**
     * Schedule reconnection
     */
    scheduleReconnect() {
        if (this.isClosed) {
            return;
        }
        if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
            this.logger.warn(`WebSocket unavailable after ${this.config.maxReconnectAttempts} attempts`);
            return;
        }
        const delay = Math.min(this.config.initialReconnectDelay * Math.pow(2, this.reconnectAttempt), this.config.maxReconnectDelay);
        this.logger.info(`WebSocket reconnecting in ${Math.round(delay / 1000)}s (${this.reconnectAttempt + 1}/${this.config.maxReconnectAttempts})`);
        const timer = setTimeout(() => {
            this.reconnectAttempt++;
            this.connect();
        }, delay);
        this.timers.push(timer);
    }
    /**
     * Remove a timer from tracking
     */
    removeTimer(timer) {
        const index = this.timers.indexOf(timer);
        if (index !== -1) {
            this.timers.splice(index, 1);
        }
    }
    /**
     * Clear all timers
     */
    clearTimers() {
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers = [];
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }
    /**
     * Start ping interval to keep connection alive
     */
    startPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
        }
        this.pingTimer = setInterval(() => {
            if (this.ws?.readyState === ws_1.default.OPEN) {
                this.ws.ping();
            }
        }, this.config.pingInterval);
    }
    /**
     * Close the WebSocket connection
     */
    close() {
        this.isClosed = true;
        this.clearTimers();
        if (this.ws) {
            try {
                this.ws.close();
            }
            catch {
                // Ignore
            }
            this.ws = null;
        }
    }
    /**
     * Check if connected
     */
    get isConnected() {
        return this.ws?.readyState === ws_1.default.OPEN;
    }
    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
            isClosed: this.isClosed,
            reconnectAttempt: this.reconnectAttempt,
        };
    }
}
exports.LevitonWebSocket = LevitonWebSocket;
/**
 * Create and connect a WebSocket
 *
 * @param loginResponse - The FULL login response from the API
 * @param devices - Array of devices to subscribe to
 * @param callback - Callback for device updates
 * @param logger - Logger instance
 * @param config - Optional configuration overrides
 */
function createWebSocket(loginResponse, devices, callback, logger, config) {
    const ws = new LevitonWebSocket(loginResponse, devices, callback, logger, config);
    ws.connect();
    return ws;
}
//# sourceMappingURL=websocket.js.map