/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Request queue with priority and deduplication
 */

import type { QueuedRequest } from '../types'

/**
 * Request queue configuration
 */
export interface RequestQueueConfig {
  /** Maximum concurrent requests */
  maxConcurrent: number
  /** Maximum queue size */
  maxQueueSize: number
  /** Request timeout in ms */
  requestTimeout: number
}

/**
 * Default request queue configuration
 */
export const DEFAULT_REQUEST_QUEUE_CONFIG: RequestQueueConfig = {
  maxConcurrent: 5,
  maxQueueSize: 100,
  requestTimeout: 30000,
}

/**
 * Request queue with priority ordering and deduplication
 */
export class RequestQueue {
  private readonly maxConcurrent: number
  private readonly maxQueueSize: number
  private readonly requestTimeout: number

  private queue: QueuedRequest[] = []
  private inFlight: Map<string, Promise<unknown>> = new Map()
  private processing = false

  constructor(config: Partial<RequestQueueConfig> = {}) {
    const merged = { ...DEFAULT_REQUEST_QUEUE_CONFIG, ...config }
    this.maxConcurrent = merged.maxConcurrent
    this.maxQueueSize = merged.maxQueueSize
    this.requestTimeout = merged.requestTimeout
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length
  }

  /**
   * Get number of in-flight requests
   */
  get inFlightCount(): number {
    return this.inFlight.size
  }

  /**
   * Check if queue is full
   */
  get isFull(): boolean {
    return this.queue.length >= this.maxQueueSize
  }

  /**
   * Add a request to the queue
   */
  add<T>(
    execute: () => Promise<T>,
    options: {
      priority?: 'high' | 'normal' | 'low'
      dedupeKey?: string
    } = {},
  ): Promise<T> {
    const { priority = 'normal', dedupeKey } = options

    // Check for duplicate in-flight request
    if (dedupeKey && this.inFlight.has(dedupeKey)) {
      return this.inFlight.get(dedupeKey) as Promise<T>
    }

    // Check queue size limit
    if (this.isFull) {
      return Promise.reject(new Error('Request queue is full'))
    }

    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id: dedupeKey || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        priority,
        execute,
        timestamp: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject,
      }

      this.enqueue(request as QueuedRequest)
      this.processQueue()
    })
  }

  /**
   * Insert request into queue by priority
   */
  private enqueue(request: QueuedRequest): void {
    // Priority order: high > normal > low
    // Within same priority, FIFO ordering
    const priorityOrder = { high: 0, normal: 1, low: 2 }
    const requestPriority = priorityOrder[request.priority]

    const insertIndex = this.queue.findIndex(
      r => priorityOrder[r.priority] > requestPriority,
    )

    if (insertIndex === -1) {
      this.queue.push(request)
    } else {
      this.queue.splice(insertIndex, 0, request)
    }
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {return}
    this.processing = true

    try {
      while (this.queue.length > 0 && this.inFlight.size < this.maxConcurrent) {
        const request = this.queue.shift()
        if (!request) {break}

        const promise = this.executeRequest(request)
        this.inFlight.set(request.id, promise)

        // Don't await - let it run concurrently
        promise.finally(() => {
          this.inFlight.delete(request.id)
          // Continue processing after completion
          setImmediate(() => this.processQueue())
        })
      }
    } finally {
      this.processing = false
    }
  }

  /**
   * Execute a single request with timeout
   */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Request timed out after ${this.requestTimeout}ms`))
      }, this.requestTimeout)
    })

    try {
      const result = await Promise.race([request.execute(), timeoutPromise])
      request.resolve(result)
    } catch (error) {
      request.reject(error as Error)
    } finally {
      // Always clear the timeout to prevent memory leaks and open handles
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  /**
   * Clear the queue
   */
  clear(): void {
    // Reject all pending requests
    for (const request of this.queue) {
      request.reject(new Error('Request queue cleared'))
    }
    this.queue = []
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queueLength: number
    inFlight: number
    maxConcurrent: number
    maxQueueSize: number
  } {
    return {
      queueLength: this.length,
      inFlight: this.inFlightCount,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
    }
  }

  /**
   * Wait for all in-flight requests to complete
   */
  async drain(): Promise<void> {
    await Promise.all(this.inFlight.values())
  }
}

/**
 * In-flight request deduplication map
 */
export class RequestDeduplicator {
  private readonly inFlight: Map<string, Promise<unknown>> = new Map()
  private readonly maxSize: number

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  /**
   * Execute a request with deduplication
   */
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Check for existing in-flight request
    const existing = this.inFlight.get(key)
    if (existing) {
      return existing as Promise<T>
    }

    // Prevent unbounded growth
    if (this.inFlight.size >= this.maxSize) {
      const firstKey = this.inFlight.keys().next().value
      if (firstKey) {
        this.inFlight.delete(firstKey)
      }
    }

    // Create and track new request
    const promise = fn().finally(() => {
      this.inFlight.delete(key)
    })

    this.inFlight.set(key, promise)
    return promise
  }

  /**
   * Get number of in-flight requests
   */
  get size(): number {
    return this.inFlight.size
  }

  /**
   * Clear all tracked requests
   */
  clear(): void {
    this.inFlight.clear()
  }
}

