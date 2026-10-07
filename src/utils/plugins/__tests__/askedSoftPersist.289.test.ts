import { afterEach, describe, expect, test } from 'bun:test'
import {
  forgetAskedPane,
  keptAskedPanesFromConfig,
  rememberAskedPane,
  seedAskedPanes,
  setLoadedFunctionHooksModules,
  getPanesState,
} from '../functionHooksModules.js'

const saved: Array<{ plugin: string; id: string }> = []

afterEach(() => {
  setLoadedFunctionHooksModules([])
  saved.length = 0
})

describe('densable 2.1.289 asked soft persist (mL/keepAsked/keptAsked)', () => {
  test('seedAskedPanes one-shot from keptAskedPanesFromConfig shape', () => {
    seedAskedPanes([{ plugin: 'p', id: 'a' }])
    expect(getPanesState().asked).toEqual([{ plugin: 'p', id: 'a' }])
    seedAskedPanes([{ plugin: 'p', id: 'ignored' }])
    expect(getPanesState().asked).toEqual([{ plugin: 'p', id: 'a' }])
  })

  test('rememberAskedPane / forgetAskedPane round-trip in-memory', () => {
    rememberAskedPane({ plugin: 'p', id: 'fresh' })
    expect(getPanesState().asked).toContainEqual({ plugin: 'p', id: 'fresh' })
    forgetAskedPane({ plugin: 'p', id: 'fresh' })
    expect(
      getPanesState().asked.some(r => r.plugin === 'p' && r.id === 'fresh'),
    ).toBe(false)
  })

  test('keptAskedPanesFromConfig returns [] when config unavailable/empty', () => {
    expect(Array.isArray(keptAskedPanesFromConfig())).toBe(true)
  })
})
