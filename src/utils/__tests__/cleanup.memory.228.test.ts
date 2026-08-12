/**
 * densable 2.1.228 #8 — project-level reserved entries (memory/) not sessions.
 */
import { describe, expect, test } from 'bun:test'
import {
  isProjectLevelReservedEntry,
  PROJECT_LEVEL_RESERVED_ENTRIES,
} from '../cleanup.js'

describe('densable 2.1.228 #8 project-level reserved entries (WMu)', () => {
  test('WMu set includes memory and companions', () => {
    expect(PROJECT_LEVEL_RESERVED_ENTRIES.has('memory')).toBe(true)
    expect(PROJECT_LEVEL_RESERVED_ENTRIES.has('tiny_memory')).toBe(true)
    expect(PROJECT_LEVEL_RESERVED_ENTRIES.has('bagel')).toBe(true)
    expect(PROJECT_LEVEL_RESERVED_ENTRIES.has('bridge-pointer.json')).toBe(true)
    expect(PROJECT_LEVEL_RESERVED_ENTRIES.has('.session-aliases')).toBe(true)
  })

  test('isProjectLevelReservedEntry matches densable KMu', () => {
    expect(isProjectLevelReservedEntry('memory')).toBe(true)
    expect(isProjectLevelReservedEntry('MEMORY')).toBe(true)
    expect(isProjectLevelReservedEntry('session-abc')).toBe(false)
    expect(
      isProjectLevelReservedEntry('a1b2c3d4-e5f6-7890-abcd-ef1234567890'),
    ).toBe(false)
  })
})
