import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetForTesting,
  createAutoModeState,
  getAutoModeFlagCli,
  isAutoModeActive,
  isAutoModeCircuitBroken,
  isAutoModeFromFallback,
  setAutoModeActive,
  setAutoModeCircuitBroken,
  setAutoModeFlagCli,
  setAutoModeFromFallback,
} from '../autoModeState.js'

afterEach(() => {
  _resetForTesting()
})

describe('autoModeState fromAutoFallback', () => {
  test('defaults to false', () => {
    expect(isAutoModeFromFallback()).toBe(false)
    expect(isAutoModeActive()).toBe(false)
    expect(getAutoModeFlagCli()).toBe(false)
    expect(isAutoModeCircuitBroken()).toBe(false)
  })

  test('setAutoModeFromFallback tracks silent auto fallback intent', () => {
    setAutoModeFromFallback(true)
    expect(isAutoModeFromFallback()).toBe(true)
    setAutoModeActive(true)
    expect(isAutoModeActive()).toBe(true)
    // Fallback flag is independent of active
    setAutoModeActive(false)
    expect(isAutoModeFromFallback()).toBe(true)
  })

  test('createAutoModeState returns a fresh object', () => {
    expect(createAutoModeState()).toEqual({
      active: false,
      flagCli: false,
      circuitBroken: false,
      fromFallback: false,
    })
  })

  test('reset clears fromFallback', () => {
    setAutoModeFromFallback(true)
    setAutoModeFlagCli(true)
    setAutoModeCircuitBroken(true)
    setAutoModeActive(true)
    _resetForTesting()
    expect(isAutoModeFromFallback()).toBe(false)
    expect(getAutoModeFlagCli()).toBe(false)
    expect(isAutoModeCircuitBroken()).toBe(false)
    expect(isAutoModeActive()).toBe(false)
  })
})
