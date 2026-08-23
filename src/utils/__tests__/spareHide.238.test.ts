/**
 * densable 2.1.238 #28 — hide unclaimed pre-warm spare from ListAgents (hya).
 * Claim = CLAUDE_JOB_DIR/state.json lstat. No storageV5 poll.
 */
import { describe, expect, test } from 'bun:test'
import { computeSpareFlag } from '../concurrentSessions.js'

describe('computeSpareFlag (bornSpare && !claimed)', () => {
  test('bg + spare source + unclaimed → true', () => {
    expect(
      computeSpareFlag({ kind: 'bg', bgSource: 'spare', claimed: false }),
    ).toBe(true)
  })

  test('bg + spare source + claimed → undefined (JSON omit)', () => {
    expect(
      computeSpareFlag({ kind: 'bg', bgSource: 'spare', claimed: true }),
    ).toBeUndefined()
  })

  test('interactive is never spare', () => {
    expect(
      computeSpareFlag({
        kind: 'interactive',
        bgSource: 'spare',
        claimed: false,
      }),
    ).toBeUndefined()
  })

  test('bg without CLAUDE_BG_SOURCE=spare is not spare', () => {
    expect(
      computeSpareFlag({ kind: 'bg', bgSource: 'user', claimed: false }),
    ).toBeUndefined()
    expect(computeSpareFlag({ kind: 'bg', claimed: false })).toBeUndefined()
  })
})

describe('listPeers hide contract', () => {
  test('hya filter is sock + not self + !spare', () => {
    const selfPid = 111
    const rows = [
      { pid: 111, messagingSocketPath: '/tmp/self.sock', spare: undefined },
      { pid: 222, messagingSocketPath: '/tmp/peer.sock', spare: undefined },
      { pid: 333, messagingSocketPath: '/tmp/spare.sock', spare: true },
      { pid: 444, messagingSocketPath: undefined, spare: undefined },
    ]
    const listed = rows.filter(
      s => s.pid !== selfPid && s.messagingSocketPath != null && !s.spare,
    )
    expect(listed.map(s => s.pid)).toEqual([222])
  })
})
