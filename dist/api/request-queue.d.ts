/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Request queue with priority and deduplication
 */
/**
 * Request queue configuration
 */
export interface RequestQueueConfig {
    /** Maximum concurrent requests */
    maxConcurrent: number;
    /** Maximum queue size */
    maxQueueSize: number;
    /** Request timeout in ms */
    requestTimeout: number;
}
/**
 * Default request queue configuration
 */
export declare const DEFAULT_REQUEST_QUEUE_CONFIG: RequestQueueConfig;
/**
 * Request queue with priority ordering and deduplication
 */
export declare class RequestQueue {
    private readonly maxConcurrent;
    private readonly maxQueueSize;
    private readonly requestTimeout;
    private queue;
    private inFlight;
    private processing;
    constructor(config?: Partial<RequestQueueConfig>);
    /**
     * Get queue length
     */
    get length(): number;
    /**
     * Get number of in-flight requests
     */
    get inFlightCount(): number;
    /**
     * Check if queue is full
     */
    get isFull(): boolean;
    /**
     * Add a request to the queue
     */
    add<T>(execute: () => Promise<T>, options?: {
        priority?: 'high' | 'normal' | 'low';
        dedupeKey?: string;
    }): Promise<T>;
    /**
     * Insert request into queue by priority
     */
    private enqueue;
    /**
     * Process queued requests
     */
    private processQueue;
    /**
     * Execute a single request with timeout
     */
    private executeRequest;
    /**
     * Clear the queue
     */
    clear(): void;
    /**
     * Get queue statistics
     */
    getStats(): {
        queueLength: number;
        inFlight: number;
        maxConcurrent: number;
        maxQueueSize: number;
    };
    /**
     * Wait for all in-flight requests to complete
     */
    drain(): Promise<void>;
}
/**
 * In-flight request deduplication map
 */
export declare class RequestDeduplicator {
    private readonly inFlight;
    private readonly maxSize;
    constructor(maxSize?: number);
    /**
     * Execute a request with deduplication
     */
    execute<T>(key: string, fn: () => Promise<T>): Promise<T>;
    /**
     * Get number of in-flight requests
     */
    get size(): number;
    /**
     * Clear all tracked requests
     */
    clear(): void;
}
//# sourceMappingURL=request-queue.d.ts.map