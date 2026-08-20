import { describe, expect, test } from 'bun:test'
import {
  isProviderManagedEnvVar,
  isSafeManagedEnv,
} from '../managedEnvConstants.js'

describe('ANTHROPIC_DEFAULT_MODEL allowlists (densable 236)', () => {
  test('is provider-managed like ANTHROPIC_MODEL', () => {
    expect(isProviderManagedEnvVar('ANTHROPIC_DEFAULT_MODEL')).toBe(true)
    expect(isProviderManagedEnvVar('ANTHROPIC_MODEL')).toBe(true)
  })

  test('is always-safe managed env', () => {
    expect(
      isSafeManagedEnv('ANTHROPIC_DEFAULT_MODEL', 'claude-sonnet-4-6'),
    ).toBe(true)
  })
})
