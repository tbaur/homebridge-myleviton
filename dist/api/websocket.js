"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview WebSocket client for real-time device updates
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LevitonWebSocket = exports.DEFAULT_WEBSOCKET_CONFIG = void 0;
exports.createWebSocket = createWebSocket;
const sockjs_client_1 = __importDefault(require("sockjs-client"));
const sanitizers_1 = require("../utils/sanitizers");
/**
 * Default WebSocket configuration
 */
exports.DEFAULT_WEBSOCKET_CONFIG = {
    socketUrl: 'https://my.leviton.com/socket',
    connectionTimeout: 10000,
    maxReconnectAttempts: 10,
    initialReconnectDelay: 1000,
    maxReconnectDelay: 60000,
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
 * WebSocket connection for real-time updates
 */
class LevitonWebSocket {
    config;
    logger;
    ws = null;
    token;
    devices;
    callback;
    reconnectAttempt = 0;
    timers = [];
    isConnecting = false;
    isClosed = false;
    constructor(token, devices, callback, logger, config = {}) {
        this.config = { ...exports.DEFAULT_WEBSOCKET_CONFIG, ...config };
        this.logger = this.normalizeLogger(logger);
        this.token = token;
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
     * Update token (after refresh)
     */
    updateToken(token) {
        this.token = token;
    }
    /**
     * Connect to WebSocket
     */
    connect() {
        if (this.isConnecting || this.isClosed) {
            return;
        }
        this.isConnecting = true;
        this.logger.debug('Connecting to WebSocket...');
        try {
            this.ws = new sockjs_client_1.default(this.config.socketUrl, undefined, {
                transports: ['websocket', 'xhr-streaming', 'xhr-polling'],
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
        this.ws.onopen = () => {
            clearTimeout(connectionTimeout);
            this.removeTimer(connectionTimeout);
            isOpen = true;
            this.isConnecting = false;
            this.reconnectAttempt = 0;
            this.logger.debug(`WebSocket connected (token: ${(0, sanitizers_1.maskToken)(this.token)})`);
        };
        this.ws.onclose = (event) => {
            this.clearTimers();
            isOpen = false;
            this.isConnecting = false;
            const code = event?.code;
            const wasClean = event?.wasClean;
            // Normal close
            if (wasClean && code === 1000) {
                this.logger.debug('WebSocket closed normally');
                return;
            }
            // Auth failure - don't reconnect
            if (code === 401) {
                this.logger.info('WebSocket auth failed (expected - device control still works)');
                return;
            }
            // Closed externally
            if (this.isClosed) {
                this.logger.debug('WebSocket closed by user');
                return;
            }
            this.logger.debug(`WebSocket closed: code=${code} wasClean=${wasClean}`);
            this.scheduleReconnect();
        };
        this.ws.onerror = (error) => {
            clearTimeout(connectionTimeout);
            this.removeTimer(connectionTimeout);
            this.logger.error(`WebSocket error: ${error.message || 'Unknown error'}`);
        };
        this.ws.onmessage = (message) => {
            this.handleMessage(message);
        };
    }
    /**
     * Handle incoming message
     */
    handleMessage(message) {
        let data;
        try {
            data = JSON.parse(message.data);
        }
        catch {
            this.logger.error(`Failed to parse WebSocket message: ${message.data}`);
            return;
        }
        if (!data || typeof data !== 'object') {
            return;
        }
        // Handle challenge
        if (data.type === MessageType.CHALLENGE) {
            this.logger.debug(`Received challenge, responding with token: ${(0, sanitizers_1.maskToken)(this.token)}`);
            this.ws?.send(JSON.stringify([{ token: this.token }]));
            return;
        }
        // Handle ready status
        if (data.type === MessageType.STATUS && data.status === STATUS_READY) {
            this.logger.debug('WebSocket ready, subscribing to devices');
            this.subscribeToDevices();
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
        for (const device of this.devices) {
            if (device?.id) {
                this.ws?.send(JSON.stringify([{
                        type: 'subscribe',
                        subscription: {
                            modelName: 'IotSwitch',
                            modelId: device.id,
                        },
                    }]));
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
        if (!notificationData.power) {
            return;
        }
        const payload = {
            id: notification.modelId,
            power: notificationData.power,
        };
        if (notificationData.brightness !== undefined) {
            payload.brightness = notificationData.brightness;
        }
        if (notificationData.occupancy !== undefined) {
            payload.occupancy = notificationData.occupancy;
        }
        this.callback(payload);
    }
    /**
     * Schedule reconnection
     */
    scheduleReconnect() {
        if (this.isClosed) {
            return;
        }
        if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
            this.logger.warn(`WebSocket reconnection failed after ${this.config.maxReconnectAttempts} attempts`);
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
        return this.ws?.readyState === sockjs_client_1.default.OPEN;
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
 */
function createWebSocket(token, devices, callback, logger, config) {
    const ws = new LevitonWebSocket(token, devices, callback, logger, config);
    ws.connect();
    return ws;
}
//# sourceMappingURL=websocket.js.map