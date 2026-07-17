import { describe, expect, test, beforeEach } from 'bun:test'
import {
  ensureFastPathSettingsLoaded,
  loadFastPathPolicy,
  resetFastPathPolicyForTesting,
} from '../fastPathPolicy.js'

describe('fastPathPolicy (official a8_)', () => {
  beforeEach(() => {
    resetFastPathPolicyForTesting()
  })

  test('ensureFastPathSettingsLoaded is idempotent', async () => {
    await ensureFastPathSettingsLoaded()
    await ensureFastPathSettingsLoaded()
  })

  test('loadFastPathPolicy returns null when no policy helper', async () => {
    const err = await loadFastPathPolicy()
    expect(err).toBeNull()
  })
})
