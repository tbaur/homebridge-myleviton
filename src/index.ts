/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Main entry point for homebridge-myleviton
 */

// Re-export everything
export * from './types'
export * from './errors'
export * from './api'
export * from './utils'

// Export platform
export { LevitonDecoraSmartPlatform } from './platform'

// Default export for Homebridge plugin registration
export { default } from './platform'

// Export version
export const VERSION = '3.2.7'

