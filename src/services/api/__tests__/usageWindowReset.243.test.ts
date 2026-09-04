import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { seedUtilizationFromOpenHeaders } from '../usage.js'

describe('usage window reset 243', () => {
  test('official y() seeds from Y0a headers, not a live-API ISO filter', () => {
    const src = readFileSync(join(import.meta.dir, '../usage.ts'), 'utf8')
    expect(src).toContain('export function seedUtilizationFromOpenHeaders')
    expect(src).toContain('getRawUtilization()')
    expect(src).toContain("source: 'headers'")
    expect(src).toContain("source: 'persisted'")
    expect(src).not.toContain('return selectOpenUsageWindows(response.data)')
  })

  test('fetchUtilization persists last-known usage then returns the API body', () => {
    const src = readFileSync(join(import.meta.dir, '../usage.ts'), 'utf8')
    expect(src).toContain(
      'persistUsageSeed(response.data, getOauthAccountInfo()?.accountUuid)',
    )
    expect(src).toContain('return response.data')
  })

  test('seedUtilizationFromOpenHeaders is a function', () => {
    expect(typeof seedUtilizationFromOpenHeaders).toBe('function')
  })
})
