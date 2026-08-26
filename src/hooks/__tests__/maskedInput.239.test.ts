// densable 2.1.239 #42 — masked inputs skip history and the kill ring.
import { describe, expect, test } from 'bun:test'
import {
  shouldPushKilledTextToRing,
  shouldRecordClearedInputInHistory,
} from '../useTextInput.js'

describe('densable 2.1.239 #42 masked input history / kill ring', () => {
  test('double-Esc records history only when mask is empty', () => {
    expect(shouldRecordClearedInputInHistory('', true, 'secret')).toBe(true)
    expect(shouldRecordClearedInputInHistory('*', true, 'secret')).toBe(false)
    expect(shouldRecordClearedInputInHistory('', true, '   ')).toBe(false)
    expect(shouldRecordClearedInputInHistory('', false, 'secret')).toBe(false)
  })

  test('kills enter the ring only when mask is empty', () => {
    expect(shouldPushKilledTextToRing('')).toBe(true)
    expect(shouldPushKilledTextToRing('*')).toBe(false)
  })
})
