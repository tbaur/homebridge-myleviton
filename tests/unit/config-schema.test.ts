/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Regression coverage for config.schema.json. Homebridge Config UI X validates
 * saved platform config against this schema with ajv (draft-07), so invalid
 * shapes (e.g. boolean `required` on a field) break the Settings GUI for every
 * user. These tests fail fast if that contract regresses.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface SchemaProperty {
  type?: string
  required?: unknown
  properties?: Record<string, SchemaProperty>
  items?: SchemaProperty
}

interface ConfigSchema {
  pluginAlias: string
  pluginType: string
  singular?: boolean
  schema: SchemaProperty & { properties: Record<string, SchemaProperty> }
  layout: unknown[]
}

/**
 * Collect every `required` value found anywhere in the schema tree. config-ui-x
 * validates the saved config with ajv (draft-07), where `required` MUST be an
 * array of property names at the object level. A boolean `"required": true` on
 * an individual field makes the whole schema fail to compile.
 */
function collectRequiredValues(node: SchemaProperty | undefined, found: unknown[]): void {
  if (!node || typeof node !== 'object') {
    return
  }
  if ('required' in node) {
    found.push(node.required)
  }
  if (node.properties) {
    for (const child of Object.values(node.properties)) {
      collectRequiredValues(child, found)
    }
  }
  collectRequiredValues(node.items, found)
}

function loadSchema(): ConfigSchema {
  const raw = readFileSync(resolve(__dirname, '../../config.schema.json'), 'utf8')
  return JSON.parse(raw) as ConfigSchema
}

describe('config.schema.json', () => {
  const schema = loadSchema()

  it('uses the platform alias the plugin registers under', () => {
    expect(schema.pluginAlias).toBe('MyLevitonDecoraSmart')
    expect(schema.pluginType).toBe('platform')
    expect(schema.singular).toBe(true)
  })

  it.each(['email', 'password'])(
    'declares %s as a string credential field',
    (field) => {
      const prop = schema.schema.properties[field]
      expect(prop).toBeDefined()
      expect(prop.type).toBe('string')
    },
  )

  it('surfaces credentials in the Account Credentials layout fieldset', () => {
    const layoutJson = JSON.stringify(schema.layout)
    expect(layoutJson).toContain('email')
    expect(layoutJson).toContain('password')
  })

  it('never declares `required` as a boolean (invalid draft-07; breaks ajv validation)', () => {
    const requiredValues: unknown[] = []
    collectRequiredValues(schema.schema, requiredValues)
    for (const value of requiredValues) {
      expect(Array.isArray(value)).toBe(true)
    }
  })

  it('requires the platform name and credentials so Homebridge 2.x does not warn on startup', () => {
    expect(schema.schema.required).toEqual(expect.arrayContaining(['name', 'email', 'password']))
  })

  it('does not declare boolean required on array item schemas', () => {
    for (const prop of Object.values(schema.schema.properties)) {
      collectRequiredValues(prop.items, [])
      if (prop.items && 'required' in prop.items) {
        expect(Array.isArray(prop.items.required)).toBe(true)
      }
    }
  })
})
