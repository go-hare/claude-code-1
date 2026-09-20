/**
 * densable 2.1.247 #30 — y6 #b / Wut=60000 skip GitHub re-check on refocus.
 */
import { describe, expect, test } from 'bun:test'
import {
  classifyPrStatusFocusRecheck,
  PR_STATUS_FOCUS_RECHECK_MS,
} from '../usePrStatus.js'

describe('densable 2.1.247 #30 PR badge focus recheck', () => {
  test('Wut is 60000', () => {
    expect(PR_STATUS_FOCUS_RECHECK_MS).toBe(60_000)
  })

  test('never fetched (#c===0) does not force a focus refresh', () => {
    expect(classifyPrStatusFocusRecheck(0, 1_000_000)).toBe('ignore')
  })

  test('last check < 1 min skips GitHub re-check', () => {
    const last = 1_000_000
    expect(classifyPrStatusFocusRecheck(last, last + 59_999)).toBe('skip')
  })

  test('last check >= 1 min refreshes', () => {
    const last = 1_000_000
    expect(classifyPrStatusFocusRecheck(last, last + 60_000)).toBe('refresh')
    expect(classifyPrStatusFocusRecheck(last, last + 60_001)).toBe('refresh')
  })
})
