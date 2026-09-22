/**
 * densable 2.1.248 stickyBetas — oe/conversationLatches; STATE LAND cut.
 * Gold: docs/upstream-extraction/v2.1.248/snippets/gold-248-stickyBetas.txt
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { getBootstrapSession } from '../../utils/sessionHost.js'
import {
  clearBetaHeaderLatches,
  getStickyBetas,
  isStickyBetaRejected,
  isStickyBetaSentActive,
  resetStateForTests,
  resetStickyBetas,
  stickyRejectBeta,
  stickySendBeta,
} from '../state.js'

const stateSrc = () =>
  readFileSync(join(import.meta.dir, '../state.ts'), 'utf8')

describe('248 stickyBetas (oe / Yd / Pvt)', () => {
  afterEach(() => {
    resetStateForTests()
  })

  test('wrappers read/write conversationLatches; STATE dual-write cut', () => {
    const src = stateSrc()
    expect(src).toContain(
      'getBootstrapSession().conversationLatches.stickyBetas()',
    )
    expect(src).toContain(
      'getBootstrapSession().conversationLatches.unlatchStickyBetas()',
    )
    expect(src).toMatch(/stickyBetas\s+[—-]\s+LAND cut/)
    expect(src).not.toContain('requestLatches.stickyBetas')
    expect(src).not.toMatch(/STATE\.stickyBetas/)
  })

  test('stickySend / stickyReject / reset round-trip on bag', () => {
    const beta = 'test-sticky-beta'
    stickySendBeta(beta)
    expect(isStickyBetaSentActive(beta)).toBe(true)
    expect(getStickyBetas().sent.has(beta)).toBe(true)
    expect(
      getBootstrapSession().conversationLatches.stickyBetas().sent.has(beta),
    ).toBe(true)

    stickyRejectBeta(beta)
    expect(isStickyBetaRejected(beta)).toBe(true)
    expect(isStickyBetaSentActive(beta)).toBe(false)
    expect(getStickyBetas().sent.has(beta)).toBe(false)

    resetStickyBetas()
    expect(isStickyBetaRejected(beta)).toBe(false)
    expect(getStickyBetas().sent.size).toBe(0)
    expect(getStickyBetas().rejected.size).toBe(0)
  })

  test('clearBetaHeaderLatches unlatches stickyBetas (Pvt else-arm)', () => {
    stickySendBeta('a')
    stickyRejectBeta('b')
    clearBetaHeaderLatches()
    expect(getStickyBetas().sent.size).toBe(0)
    expect(getStickyBetas().rejected.size).toBe(0)
    expect(
      getBootstrapSession().conversationLatches.stickyBetas().sent.size,
    ).toBe(0)
  })
})
