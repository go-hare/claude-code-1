import { afterEach, describe, expect, test } from 'bun:test'
import {
  notifyUltracodeActive,
  resetUltracodeActiveForTesting,
  setSessionMetadataChangedListener,
  settleUltracodeActive,
  ultracodeActivePatch,
} from '../sessionState.js'

describe('#1373 SessionState ultracode active metadata', () => {
  afterEach(() => {
    setSessionMetadataChangedListener(null)
    resetUltracodeActiveForTesting()
  })

  test('ultracodeActivePatch emits boolean true or null on change only', () => {
    const updates: Array<Record<string, unknown>> = []
    setSessionMetadataChangedListener(meta => {
      updates.push(meta as Record<string, unknown>)
    })

    expect(ultracodeActivePatch(false)).toEqual({})
    notifyUltracodeActive(false)
    expect(updates).toHaveLength(0)

    notifyUltracodeActive(true)
    expect(updates).toEqual([{ is_ultracode_active: true }])

    notifyUltracodeActive(true)
    expect(updates).toHaveLength(1)

    notifyUltracodeActive(false)
    expect(updates).toEqual([
      { is_ultracode_active: true },
      { is_ultracode_active: null },
    ])
  })

  test('settleUltracodeActive adopts restored external metadata before first write', () => {
    const updates: Array<Record<string, unknown>> = []
    setSessionMetadataChangedListener(meta => {
      updates.push(meta as Record<string, unknown>)
    })

    settleUltracodeActive(true, {
      external: { is_ultracode_active: true },
      internal: null,
    })
    expect(updates).toHaveLength(0)

    resetUltracodeActiveForTesting()
    settleUltracodeActive(false, {
      external: null,
      internal: null,
      readFailed: true,
    })
    expect(updates).toEqual([{ is_ultracode_active: null }])
  })
})
