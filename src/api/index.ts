/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview API module exports
 */

// Client
export { LevitonApiClient, getApiClient, resetGlobalClient } from './client'
export type { ApiClientConfig } from './client'

// Rate Limiter
export { RateLimiter, getRateLimiter, resetGlobalRateLimiter } from './rate-limiter'
export type { RateLimiterConfig } from './rate-limiter'

// Circuit Breaker
export { CircuitBreaker, getCircuitBreaker, resetGlobalCircuitBreaker, CircuitState } from './circuit-breaker'
export type { CircuitBreakerConfig, CircuitBreakerStatus } from './circuit-breaker'

// Cache
export { ResponseCache, getResponseCache, resetGlobalCache } from './cache'
export type { CacheConfig } from './cache'

// Request Queue
export { RequestQueue, RequestDeduplicator } from './request-queue'
export type { RequestQueueConfig } from './request-queue'

// Persistence
export { DevicePersistence, getDevicePersistence, resetGlobalPersistence, PERSISTENCE_FILE_NAME } from './persistence'
export type { PersistenceConfig } from './persistence'

// WebSocket
export { LevitonWebSocket, createWebSocket } from './websocket'
export type { WebSocketConfig } from './websocket'

