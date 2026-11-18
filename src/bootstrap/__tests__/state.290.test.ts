import { describe, expect, test } from 'bun:test'
import {
  clearCarriedEffortFromLatch,
  clearRefusalFallbackModelLatch,
  consumeRefusalFallbackModelLatch,
  getRefusalFallbackModelLatch,
  resetStateForTests,
  setMainLoopModelOverride,
  setRefusalFallbackModelLatch,
  takeCarriedEffortEnd,
} from '../state.js'

describe('v2.1.290 #36 RefusalFallbackModelLatch carriedEffort', () => {
  test('stores carriedEffort and records end reason when cleared or superseded', () => {
    resetStateForTests()
    setMainLoopModelOverride('claude-sonnet-4-6')
    setRefusalFallbackModelLatch({
      fallbackModel: 'claude-sonnet-4-6',
      previousOverride: 'claude-opus-4-6',
      carriedEffort: 'high',
    })
    expect(getRefusalFallbackModelLatch()?.carriedEffort).toBe('high')
    expect(takeCarriedEffortEnd()).toBeUndefined()

    clearCarriedEffortFromLatch('kill_switch')
    expect(getRefusalFallbackModelLatch()?.carriedEffort).toBeUndefined()
    expect(takeCarriedEffortEnd()).toBe('kill_switch')
    expect(takeCarriedEffortEnd()).toBeUndefined()

    setRefusalFallbackModelLatch({
      fallbackModel: 'claude-sonnet-4-6',
      previousOverride: 'claude-opus-4-6',
      carriedEffort: 'max',
    })
    clearRefusalFallbackModelLatch('model_change')
    expect(takeCarriedEffortEnd()).toBe('model_change')

    setMainLoopModelOverride('claude-sonnet-4-6')
    setRefusalFallbackModelLatch({
      fallbackModel: 'claude-sonnet-4-6',
      previousOverride: 'claude-opus-4-6',
      carriedEffort: 'medium',
    })
    const consumed = consumeRefusalFallbackModelLatch()
    expect(consumed?.fallbackModel).toBe('claude-sonnet-4-6')
    expect(takeCarriedEffortEnd()).toBe('unlatched')
    resetStateForTests()
  })
})
