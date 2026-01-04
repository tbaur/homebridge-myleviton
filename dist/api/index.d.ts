/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview API module exports
 */
export { LevitonApiClient, getApiClient, resetGlobalClient } from './client';
export type { ApiClientConfig } from './client';
export { RateLimiter, getRateLimiter, resetGlobalRateLimiter } from './rate-limiter';
export type { RateLimiterConfig } from './rate-limiter';
export { CircuitBreaker, getCircuitBreaker, resetGlobalCircuitBreaker, CircuitState } from './circuit-breaker';
export type { CircuitBreakerConfig, CircuitBreakerStatus } from './circuit-breaker';
export { ResponseCache, getResponseCache, resetGlobalCache } from './cache';
export type { CacheConfig } from './cache';
export { RequestQueue, RequestDeduplicator } from './request-queue';
export type { RequestQueueConfig } from './request-queue';
export { DevicePersistence, getDevicePersistence, resetGlobalPersistence, PERSISTENCE_FILE_NAME } from './persistence';
export type { PersistenceConfig } from './persistence';
export { LevitonWebSocket, createWebSocket } from './websocket';
export type { WebSocketConfig } from './websocket';
//# sourceMappingURL=index.d.ts.map