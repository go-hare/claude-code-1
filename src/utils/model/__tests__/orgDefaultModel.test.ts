import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getDefaultModelAttributionBadge,
  getOrgModelDefaultCache,
  getResolvedOrgDefaultModel,
  shouldOrgDefaultOverrideUserSelection,
} from '../orgDefaultModel.js'

const originalProvider = process.env.CLAUDE_CODE_USE_BEDROCK

describe('orgDefaultModel', () => {
  beforeEach(() => {
    // Ensure first-party provider for org default resolution.
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
  })

  afterEach(() => {
    if (originalProvider !== undefined) {
      process.env.CLAUDE_CODE_USE_BEDROCK = originalProvider
    }
  })

  test('getDefaultModelAttributionBadge maps org / enforced / tier', () => {
    expect(getDefaultModelAttributionBadge('org')).toBe(' · Org default')
    expect(getDefaultModelAttributionBadge('enforced')).toBe(
      ' · Set by your organization',
    )
    expect(getDefaultModelAttributionBadge('entitlement')).toBe(
      ' · Set by your organization',
    )
    expect(getDefaultModelAttributionBadge('tier')).toBe('')
  })

  test('getOrgModelDefaultCache returns null without cache', () => {
    // Without a real global config mock, absence is null — function is pure over config.
    // Smoke: does not throw.
    expect(() => getOrgModelDefaultCache()).not.toThrow()
    expect(() => getResolvedOrgDefaultModel()).not.toThrow()
    expect(() => shouldOrgDefaultOverrideUserSelection()).not.toThrow()
  })
})
