/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview WebSocket client for real-time device updates
 */
import type { WebSocketPayload, DeviceInfo, Logger } from '../types';
/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
    /** Socket URL */
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
 */
export declare class LevitonWebSocket {
    private readonly config;
    private readonly logger;
    private ws;
    private token;
    private devices;
    private callback;
    private reconnectAttempt;
    private timers;
    private isConnecting;
    private isClosed;
    constructor(token: string, devices: DeviceInfo[], callback: (payload: WebSocketPayload) => void, logger: WebSocketLogger | Logger, config?: Partial<WebSocketConfig>);
    /**
     * Normalize logger to standard interface
     */
    private normalizeLogger;
    /**
     * Update token (after refresh)
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
 */
export declare function createWebSocket(token: string, devices: DeviceInfo[], callback: (payload: WebSocketPayload) => void, logger: WebSocketLogger | Logger, config?: Partial<WebSocketConfig>): LevitonWebSocket;
export {};
//# sourceMappingURL=websocket.d.ts.map