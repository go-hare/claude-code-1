/**
 * densable nZn body — resolveAdvisorModelForBase for get_settings.applied.advisor
 * (enablement gate tested separately via isAdvisorEnabled / env gates).
 */
import { describe, expect, test } from 'bun:test'
import {
  isValidAdvisorModel,
  modelSupportsAdvisor,
  resolveAdvisorModelForBase,
  resolveAppliedAdvisorModel,
} from '../advisor.js'

describe('resolveAdvisorModelForBase (densable nZn body)', () => {
  test('returns undefined when base model does not support advisor', () => {
    expect(modelSupportsAdvisor('claude-haiku-4-5')).toBe(false)
    expect(
      resolveAdvisorModelForBase('claude-opus-4-7', 'claude-haiku-4-5'),
    ).toBeUndefined()
  })

  test('returns undefined for invalid advisor model', () => {
    expect(isValidAdvisorModel('claude-haiku-4-5')).toBe(false)
    expect(
      resolveAdvisorModelForBase('claude-haiku-4-5', 'claude-opus-4-7'),
    ).toBeUndefined()
  })

  test('returns normalized advisor when base + advisor are valid', () => {
    expect(modelSupportsAdvisor('claude-opus-4-7')).toBe(true)
    expect(isValidAdvisorModel('claude-opus-4-7')).toBe(true)
    const result = resolveAdvisorModelForBase(
      'claude-opus-4-7',
      'claude-sonnet-4-6',
    )
    expect(result).toBeTruthy()
    expect(String(result)).toContain('opus')
  })
})

describe('resolveAppliedAdvisorModel (densable nZn enablement)', () => {
  test('returns undefined when advisorModel is missing (even if enabled)', () => {
    // Without experimental advisor force-on, isAdvisorEnabled is typically false
    // in test env — either way missing advisor must short-circuit.
    expect(
      resolveAppliedAdvisorModel(undefined, 'claude-opus-4-7'),
    ).toBeUndefined()
    expect(resolveAppliedAdvisorModel('', 'claude-opus-4-7')).toBeUndefined()
  })
})
