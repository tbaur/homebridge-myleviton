"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Request queue with priority and deduplication
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestDeduplicator = exports.RequestQueue = exports.DEFAULT_REQUEST_QUEUE_CONFIG = void 0;
/**
 * Default request queue configuration
 */
exports.DEFAULT_REQUEST_QUEUE_CONFIG = {
    maxConcurrent: 5,
    maxQueueSize: 100,
    requestTimeout: 30000,
};
/**
 * Request queue with priority ordering and deduplication
 */
class RequestQueue {
    maxConcurrent;
    maxQueueSize;
    requestTimeout;
    queue = [];
    inFlight = new Map();
    processing = false;
    constructor(config = {}) {
        const merged = { ...exports.DEFAULT_REQUEST_QUEUE_CONFIG, ...config };
        this.maxConcurrent = merged.maxConcurrent;
        this.maxQueueSize = merged.maxQueueSize;
        this.requestTimeout = merged.requestTimeout;
    }
    /**
     * Get queue length
     */
    get length() {
        return this.queue.length;
    }
    /**
     * Get number of in-flight requests
     */
    get inFlightCount() {
        return this.inFlight.size;
    }
    /**
     * Check if queue is full
     */
    get isFull() {
        return this.queue.length >= this.maxQueueSize;
    }
    /**
     * Add a request to the queue
     */
    add(execute, options = {}) {
        const { priority = 'normal', dedupeKey } = options;
        // Check for duplicate in-flight request
        if (dedupeKey && this.inFlight.has(dedupeKey)) {
            return this.inFlight.get(dedupeKey);
        }
        // Check queue size limit
        if (this.isFull) {
            return Promise.reject(new Error('Request queue is full'));
        }
        return new Promise((resolve, reject) => {
            const request = {
                id: dedupeKey || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                priority,
                execute,
                timestamp: Date.now(),
                resolve: resolve,
                reject,
            };
            this.enqueue(request);
            this.processQueue();
        });
    }
    /**
     * Insert request into queue by priority
     */
    enqueue(request) {
        // Priority order: high > normal > low
        // Within same priority, FIFO ordering
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const requestPriority = priorityOrder[request.priority];
        const insertIndex = this.queue.findIndex(r => priorityOrder[r.priority] > requestPriority);
        if (insertIndex === -1) {
            this.queue.push(request);
        }
        else {
            this.queue.splice(insertIndex, 0, request);
        }
    }
    /**
     * Process queued requests
     */
    async processQueue() {
        if (this.processing) {
            return;
        }
        this.processing = true;
        try {
            while (this.queue.length > 0 && this.inFlight.size < this.maxConcurrent) {
                const request = this.queue.shift();
                if (!request) {
                    break;
                }
                const promise = this.executeRequest(request);
                this.inFlight.set(request.id, promise);
                // Don't await - let it run concurrently
                promise.finally(() => {
                    this.inFlight.delete(request.id);
                    // Continue processing after completion
                    setImmediate(() => this.processQueue());
                });
            }
        }
        finally {
            this.processing = false;
        }
    }
    /**
     * Execute a single request with timeout
     */
    async executeRequest(request) {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`Request timed out after ${this.requestTimeout}ms`));
            }, this.requestTimeout);
        });
        try {
            const result = await Promise.race([request.execute(), timeoutPromise]);
            request.resolve(result);
        }
        catch (error) {
            request.reject(error);
        }
        finally {
            // Always clear the timeout to prevent memory leaks and open handles
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }
    /**
     * Clear the queue
     */
    clear() {
        // Reject all pending requests
        for (const request of this.queue) {
            request.reject(new Error('Request queue cleared'));
        }
        this.queue = [];
    }
    /**
     * Get queue statistics
     */
    getStats() {
        return {
            queueLength: this.length,
            inFlight: this.inFlightCount,
            maxConcurrent: this.maxConcurrent,
            maxQueueSize: this.maxQueueSize,
        };
    }
    /**
     * Wait for all in-flight requests to complete
     */
    async drain() {
        await Promise.all(this.inFlight.values());
    }
}
exports.RequestQueue = RequestQueue;
/**
 * In-flight request deduplication map
 */
class RequestDeduplicator {
    inFlight = new Map();
    maxSize;
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
    }
    /**
     * Execute a request with deduplication
     */
    async execute(key, fn) {
        // Check for existing in-flight request
        const existing = this.inFlight.get(key);
        if (existing) {
            return existing;
        }
        // Prevent unbounded growth
        if (this.inFlight.size >= this.maxSize) {
            const firstKey = this.inFlight.keys().next().value;
            if (firstKey) {
                this.inFlight.delete(firstKey);
            }
        }
        // Create and track new request
        const promise = fn().finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, promise);
        return promise;
    }
    /**
     * Get number of in-flight requests
     */
    get size() {
        return this.inFlight.size;
    }
    /**
     * Clear all tracked requests
     */
    clear() {
        this.inFlight.clear();
    }
}
exports.RequestDeduplicator = RequestDeduplicator;
//# sourceMappingURL=request-queue.js.map