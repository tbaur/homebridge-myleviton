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
import type { WebSocketPayload, DeviceInfo, Logger, LoginResponse } from '../types';
/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
    /** Socket URL - must be native WebSocket endpoint */
    socketUrl: string;
    /** Connection timeout in ms */
    connectionTimeout: number;
    /** Maximum reconnection attempts */
    maxReconnectAttempts: number;
    /** Initial reconnection delay in ms */
    initialReconnectDelay: number;
    /** Maximum reconnection delay in ms */
    maxReconnectDelay: number;
}
/**
 * Default WebSocket configuration
 * Note: Uses native WebSocket endpoint, NOT SockJS
 */
export declare const DEFAULT_WEBSOCKET_CONFIG: WebSocketConfig;
/**
 * Logger interface for WebSocket
 */
interface WebSocketLogger {
    debug: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
}
/**
 * WebSocket connection for real-time updates
 *
 * Uses native WebSocket (not SockJS) and sends full login response for auth.
 */
export declare class LevitonWebSocket {
    private readonly config;
    private readonly logger;
    private ws;
    private loginResponse;
    private devices;
    private callback;
    private reconnectAttempt;
    private timers;
    private isConnecting;
    private isClosed;
    /**
     * Create a new WebSocket connection
     *
     * @param loginResponse - The FULL login response from the API (not just the token id!)
     * @param devices - Array of devices to subscribe to
     * @param callback - Callback for device updates
     * @param logger - Logger instance
     * @param config - Optional configuration overrides
     */
    constructor(loginResponse: LoginResponse, devices: DeviceInfo[], callback: (payload: WebSocketPayload) => void, logger: WebSocketLogger | Logger, config?: Partial<WebSocketConfig>);
    /**
     * Normalize logger to standard interface
     */
    private normalizeLogger;
    /**
     * Update login response (after token refresh)
     *
     * @param loginResponse - The new full login response
     */
    updateLoginResponse(loginResponse: LoginResponse): void;
    /**
     * Legacy method for compatibility - prefer updateLoginResponse
     * @deprecated Use updateLoginResponse instead
     */
    updateToken(token: string): void;
    /**
     * Connect to WebSocket
     */
    connect(): void;
    /**
     * Setup WebSocket event handlers
     */
    private setupEventHandlers;
    /**
     * Handle incoming message
     */
    private handleMessage;
    /**
     * Subscribe to device updates
     */
    private subscribeToDevices;
    /**
     * Handle notification message
     */
    private handleNotification;
    /**
     * Schedule reconnection
     */
    private scheduleReconnect;
    /**
     * Remove a timer from tracking
     */
    private removeTimer;
    /**
     * Clear all timers
     */
    private clearTimers;
    /**
     * Close the WebSocket connection
     */
    close(): void;
    /**
     * Check if connected
     */
    get isConnected(): boolean;
    /**
     * Get connection status
     */
    getStatus(): {
        isConnected: boolean;
        isConnecting: boolean;
        isClosed: boolean;
        reconnectAttempt: number;
    };
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
export declare function createWebSocket(loginResponse: LoginResponse, devices: DeviceInfo[], callback: (payload: WebSocketPayload) => void, logger: WebSocketLogger | Logger, config?: Partial<WebSocketConfig>): LevitonWebSocket;
export {};
//# sourceMappingURL=websocket.d.ts.map