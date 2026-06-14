/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Minimal integration smoke tests (no live Leviton API calls)
 */

import { LevitonDecoraSmartPlatform } from '../../src/platform'
import { LevitonApiClient } from '../../src/api/client'
import { ALL_KNOWN_MODELS } from '../../src/platform/device-models'

describe('integration smoke', () => {
  it('exports the platform and API client', () => {
    expect(LevitonDecoraSmartPlatform).toBeDefined()
    expect(LevitonApiClient).toBeDefined()
  })

  it('shares a single device model registry', () => {
    expect(ALL_KNOWN_MODELS.length).toBeGreaterThan(0)
    expect(ALL_KNOWN_MODELS).toContain('DW6HD')
  })
})
