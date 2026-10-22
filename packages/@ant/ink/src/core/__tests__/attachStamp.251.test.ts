/**
 * densable 2.1.251 Won / Hlt / LGe / Rlt — daemon attach-stable wait.
 * Gold: official-251 SEA @189425400.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getAttachStampMs,
  isAttachUnstable,
  markDetachedSinceLastAttach,
  resetAttachStampForTests,
  stampAttachTime,
  waitUntilAttachStable,
} from '../attachStamp.js'

const prevBackend = process.env.CLAUDE_BG_BACKEND

afterEach(() => {
  resetAttachStampForTests()
  if (prevBackend === undefined) delete process.env.CLAUDE_BG_BACKEND
  else process.env.CLAUDE_BG_BACKEND = prevBackend
})

describe('densable LGe / Won / Hlt', () => {
  test('289 Ext is always false (gold `return !1`)', () => {
    delete process.env.CLAUDE_BG_BACKEND
    stampAttachTime(Date.now())
    expect(isAttachUnstable(Date.now())).toBe(false)
    process.env.CLAUDE_BG_BACKEND = 'daemon'
    stampAttachTime(0)
    expect(getAttachStampMs()).toBe(0)
    markDetachedSinceLastAttach()
    expect(isAttachUnstable(Date.now())).toBe(false)
    stampAttachTime(1000)
    expect(getAttachStampMs()).toBe(1000)
    stampAttachTime(2000)
    expect(getAttachStampMs()).toBe(1000)
    markDetachedSinceLastAttach()
    stampAttachTime(3000)
    expect(getAttachStampMs()).toBe(3000)
    expect(isAttachUnstable(3000)).toBe(false)
    expect(isAttachUnstable(3500)).toBe(false)
  })

  test('Rlt returns immediately when LGe is false', async () => {
    delete process.env.CLAUDE_BG_BACKEND
    await waitUntilAttachStable()
  })
})
