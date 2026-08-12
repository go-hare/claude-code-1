/**
 * densable 2.1.224 #19 — when unarchive is gone and we mint a fresh server
 * session, do NOT flush prior local history into the new session.
 *
 * densable: Ge=!0 on mint-after-gone; connect gate is
 *   if (!ur && f && f.length > 0 && !Ge) flushHistory(...)
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const corePath = join(import.meta.dir, '../remoteBridgeCore.ts')
const core = readFileSync(corePath, 'utf8')

describe('densable 2.1.224 #19 skipInitialHistoryFlush (Ge)', () => {
  test('declares skipInitialHistoryFlush and sets it on unarchive gone', () => {
    expect(core).toContain('let skipInitialHistoryFlush = false')
    expect(core).toContain('skipInitialHistoryFlush = true')
    // set before mint, not after
    const setIdx = core.indexOf('skipInitialHistoryFlush = true')
    const mintIdx = core.indexOf(
      'const minted = await mintFreshSession()',
      setIdx,
    )
    expect(setIdx).toBeGreaterThan(-1)
    expect(mintIdx).toBeGreaterThan(setIdx)
    // only on unarchive-gone path (near reattach_fallback log)
    const goneSlice = core.slice(
      core.indexOf("outcome === 'gone'") - 40,
      core.indexOf("outcome === 'gone'") + 900,
    )
    expect(goneSlice).toContain('skipInitialHistoryFlush = true')
    expect(goneSlice).toContain('bridge_repl_v2_reattach_fallback')
  })

  test('connect flushHistory requires !skipInitialHistoryFlush', () => {
    expect(core).toContain('!skipInitialHistoryFlush')
    // flush call is under the densable !Ge gate
    const connectGate = core.indexOf(
      'initialMessages.length > 0 &&\n        !skipInitialHistoryFlush',
    )
    const altGate = core.indexOf(
      'initialMessages.length > 0 &&\n      !skipInitialHistoryFlush',
    )
    expect(connectGate > -1 || altGate > -1).toBe(true)
    const gateIdx = Math.max(connectGate, altGate)
    const flushIdx = core.indexOf('void flushHistory(initialMessages)', gateIdx)
    expect(flushIdx).toBeGreaterThan(gateIdx)
  })

  test('flushGate.start also gated (no hang waiting for skipped flush)', () => {
    expect(core).toMatch(
      /initialMessages\.length > 0 &&\s*\n\s*!skipInitialHistoryFlush/,
    )
    // start() appears after the gate comment about densable Ge
    expect(core).toContain(
      'no initial\n  // history flush after mint-from-gone',
    )
  })
})
